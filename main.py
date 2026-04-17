import asyncio
import aiohttp
from collections import defaultdict
from typing import Dict, Any
from config import MACHINES, SENSORS, SIM_SERVER_URL, SENSOR_MAP, DATABASE_URL
from config import HISTORY_API_HOST, HISTORY_API_PORT
from app.ingestion import stream_live_data, load_history
from app.baseline import BaselineEngine
from app.anomaly import AnomalyDetector
from app.alert_store import AlertStore
from app.database import TelemetryRepository
from app.history_api import start_history_api
from app.llm_explainer import explain_alert
from app.dashboard import render_dashboard


def status_from_risk(risk: float) -> str:
    if risk >= 0.8:
        return "CRITICAL"
    if risk >= 0.6:
        return "WARNING"
    return "OPERATIONAL"

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
    telemetry_repo = TelemetryRepository(DATABASE_URL)
    telemetry_repo.initialize()
    history_api_runner = await start_history_api(telemetry_repo, HISTORY_API_HOST, HISTORY_API_PORT)
    print(f"📚 History API online at http://{HISTORY_API_HOST}:{HISTORY_API_PORT}/api/history")

    try:
        # Pre-load history to calibrate baselines
        print("🔭 Calibrating baselines from simulation history...")
        history_df = await load_history()
        baseline_engine = BaselineEngine()
        baseline_engine.train(history_df)
        
        alert_store = AlertStore()
        detector = AnomalyDetector(baseline_engine, alert_store)
        
        latest_values: Dict[str, Dict[str, float]] = defaultdict(dict)
        latest_risks: Dict[str, float] = {m: 0.0 for m in MACHINES}
        last_status: Dict[str, str] = {m: "OPERATIONAL" for m in MACHINES}

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
            try:
                telemetry_repo.save_reading(event, risk)
                current_status = status_from_risk(risk)
                if current_status != last_status[m]:
                    telemetry_repo.log_event(
                        machine_id=m,
                        event_type="status_transition",
                        status=current_status,
                        severity="critical" if current_status == "CRITICAL" else ("warning" if current_status == "WARNING" else "info"),
                        message=f"Status changed from {last_status[m]} to {current_status}",
                        timestamp=event.get("timestamp"),
                        details={"previous_status": last_status[m], "risk": risk, "sensor_z": sensor_z},
                    )
                    last_status[m] = current_status
            except Exception as db_err:
                print(f"Database write failed: {db_err}")
            
            detector.check_silence()
            
            # Pop highest priority alert for processing
            alert = alert_store.pop_highest_priority()
            if alert:
                explanation = explain_alert(alert.machine_id, alert.risk, alert.details)
                alert.details["explanation"] = explanation
                try:
                    telemetry_repo.log_event(
                        machine_id=alert.machine_id,
                        event_type="anomaly_alert",
                        status=status_from_risk(alert.risk),
                        severity="critical" if alert.risk >= 0.8 else "warning",
                        message=alert.message,
                        details=alert.details,
                    )
                except Exception as db_err:
                    print(f"Database event write failed: {db_err}")
                
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
    finally:
        await history_api_runner.cleanup()

if __name__ == "__main__":
    try:
        asyncio.run(agent_loop())
    except KeyboardInterrupt:
        print("\nSentinel 4 mission terminated.")
    except Exception as e:
        print(f"\nCRITICAL ERROR: {e}")
