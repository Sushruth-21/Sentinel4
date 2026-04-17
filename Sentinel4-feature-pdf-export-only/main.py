import asyncio
import aiohttp
from collections import defaultdict
from typing import Dict, Any
from config import MACHINES, SENSORS, SIM_SERVER_URL, SENSOR_MAP
from app.ingestion import stream_live_data, load_history
from app.baseline import BaselineEngine
from app.anomaly import AnomalyDetector
from app.alert_store import AlertStore
from app.llm_explainer import explain_alert
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
            if alert.risk >= 0.75:
                await send_alert_to_sim_server(
                    alert.machine_id, 
                    alert.risk, 
                    explanation, 
                    latest_values[alert.machine_id]
                )
            
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
