import asyncio
import aiohttp
import time
from collections import defaultdict
from typing import Dict, Any
from config import (
    MACHINES, SENSORS, SIM_SERVER_URL, SENSOR_MAP,
    VOICE_ALERT_COUNT_THRESHOLD, VOICE_ALERT_WINDOW_SECONDS,
    VOICE_CALL_COOLDOWN_SECONDS, GLOBAL_VOICE_COOLDOWN_SECONDS
)
from app.ingestion import stream_live_data, load_history
from app.baseline import BaselineEngine
from app.anomaly import AnomalyDetector
from app.alert_store import AlertStore
from app.llm_explainer import explain_alert
from app.voice_broadcaster import broadcast_voice_alert
from app.dashboard import render_dashboard

async def send_alert_to_sim_server(machine_id: str, risk: float, message: str, reading: Dict[str, float]):
    """Push detected anomaly to the simulation server for the competition."""
    url = f"{SIM_SERVER_URL}/alert"
    # Map reading keys back to simulation server names
    sim_reading = {}
    for internal_key, sim_key in SENSOR_MAP.items():
        if internal_key in reading:
            sim_reading[sim_key] = reading[internal_key]
            
    payload = {
        "machine_id": machine_id,
        "reason": f"AI_DIAGNOSTIC[Risk {risk:.2f}]: {message}",
        "reading": sim_reading
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    # In a real environment, you'd log the successful broadcast
                    pass
    except Exception as e:
        print(f"Failed to post alert to simulation server: {e}")

async def agent_loop():
    # Pre-load history to calibrate baselines
    print("🔭 Calibrating baselines from simulation history...")
    history_df = await load_history()
    baseline_engine = BaselineEngine()
    baseline_engine.train(history_df)
    
    alert_store = AlertStore()
    detector = AnomalyDetector(baseline_engine, alert_store)
    
    latest_values: Dict[str, Dict[str, float]] = defaultdict(dict)
    latest_risks: Dict[str, float] = {m: 0.0 for m in MACHINES}
    last_alert_time: Dict[str, float] = {} # Track last alert time per machine
    last_voice_call_time: Dict[str, float] = {} # Track last voice call time per machine
    last_global_voice_call_time: float = 0 # Track last call across all machines
    
    # Track voice alert criteria
    alert_history: Dict[str, list] = defaultdict(list) # machine_id -> [timestamps]

    print("🚀 Sentinel 4 MISSION CONTROL active. Listening to SSE streams...")
    async for event in stream_live_data():
        m = event.get("machine_id")
        if m not in MACHINES:
            continue
            
        for s in SENSORS:
            if s in event:
                latest_values[m][s] = float(event[s])
        
        risk, sensor_z = detector.process_reading(event)
        latest_risks[m] = risk
        
        detector.check_silence()
        
        # Pop highest priority alert for processing
        alert = alert_store.pop_highest_priority()
        if alert:
            explanation = explain_alert(alert.machine_id, alert.risk, alert.details)
            alert.details["explanation"] = explanation
            
            # Mission Goal: Report anomalies to simulation server
            current_time = time.time()
            if alert.risk >= 0.75:
                # 1. Update alert history for this machine
                alert_history[alert.machine_id].append(current_time)
                # Cleanup old alerts from history (outside the window)
                alert_history[alert.machine_id] = [
                    t for t in alert_history[alert.machine_id] 
                    if current_time - t <= VOICE_ALERT_WINDOW_SECONDS
                ]

                # 2. Handle API Alert (Simulation Server) - using 60s cooldown
                last_sent = last_alert_time.get(alert.machine_id, 0)
                if current_time - last_sent > 60:
                    await send_alert_to_sim_server(
                        alert.machine_id, 
                        alert.risk, 
                        explanation, 
                        latest_values[alert.machine_id]
                    )
                    last_alert_time[alert.machine_id] = current_time
                    print(f"📢 Alert posted to server for {alert.machine_id}")

                # 3. Handle Twilio Voice Call - using threshold + window + cooldowns
                if len(alert_history[alert.machine_id]) >= VOICE_ALERT_COUNT_THRESHOLD:
                    last_voice_call = last_voice_call_time.get(alert.machine_id, 0)
                    time_since_last_global = current_time - last_global_voice_call_time
                    
                    # Check both per-machine cooldown AND factory-wide global cooldown
                    if (current_time - last_voice_call > VOICE_CALL_COOLDOWN_SECONDS) and \
                       (time_since_last_global > GLOBAL_VOICE_COOLDOWN_SECONDS):
                        
                        broadcast_voice_alert(f"Emergency persistent alert for machine {alert.machine_id}. {explanation}")
                        
                        last_voice_call_time[alert.machine_id] = current_time
                        last_global_voice_call_time = current_time # Update global clock
                        print(f"📞 Voice alert triggered for {alert.machine_id} after {VOICE_ALERT_COUNT_THRESHOLD} detections.")
                    else:
                        print(f"🔇 Voice call suppressed by cooldown (Global: {time_since_last_global:.0f}s)")
                    
                    # Clear history for this machine after check to start a fresh window
                    alert_history[alert.machine_id] = []
            
            # Keep history updated
            if alert_store.history:
                alert_store.history[-1].details["explanation"] = explanation
        
        render_dashboard(latest_values, latest_risks, alert_store)

if __name__ == "__main__":
    try:
        asyncio.run(agent_loop())
    except KeyboardInterrupt:
        print("\nSentinel 4 mission terminated.")
    except Exception as e:
        print(f"\nCRITICAL ERROR: {e}")
