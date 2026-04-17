import asyncio
from collections import defaultdict
from typing import Dict
from config import MACHINES, SENSORS
from app.ingestion import fake_stream_from_history  # replace with stream_live_data during live API
from app.baseline import BaselineEngine
from app.anomaly import AnomalyDetector
from app.alert_store import AlertStore
from app.llm_explainer import explain_alert
from app.dashboard import render_dashboard

async def agent_loop():
    baseline_engine = BaselineEngine()
    alert_store = AlertStore()
    detector = AnomalyDetector(baseline_engine, alert_store)
    
    latest_values: Dict[str, Dict[str, float]] = defaultdict(dict)
    latest_risks: Dict[str, float] = {m: 0.0 for m in MACHINES}

    # Use fake_stream_from_history() for testing; switch to stream_live_data() with real API
    async for event in fake_stream_from_history(delay=0.5):
        m = event.get("machine_id")
        if m not in MACHINES:
            continue
            
        for s in SENSORS:
            if s in event:
                latest_values[m][s] = float(event[s])
        
        risk, sensor_z = detector.process_reading(event)
        latest_risks[m] = risk
        
        # check for silence on other machines
        detector.check_silence()
        
        # optional: get highest-priority alert and explain it
        alert = alert_store.pop_highest_priority()
        if alert:
            explanation = explain_alert(alert.machine_id, alert.risk, alert.details)
            # store explanation inside details for dashboard / history
            alert.details["explanation"] = explanation
            # also update the alert in history
            if alert_store.history:
                alert_store.history[-1].details["explanation"] = explanation
        
        # update dashboard
        render_dashboard(latest_values, latest_risks, alert_store)

if __name__ == "__main__":
    try:
        asyncio.run(agent_loop())
    except KeyboardInterrupt:
        print("\nSentinel 4 stopped.")
