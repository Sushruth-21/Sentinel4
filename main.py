import asyncio
from collections import defaultdict
from typing import Any, Dict

import aiohttp

from app.alert_store import AlertStore
from app.anomaly import AnomalyDetector
from app.baseline import BaselineEngine
from app.dashboard import render_dashboard
from app.database import TelemetryRepository
from app.history_api import start_history_api
from app.ingestion import load_history, stream_live_data
from app.llm_explainer import explain_alert
from app.status_utils import normalize_status_label, risk_from_status
from config import DATABASE_URL, HISTORY_API_HOST, HISTORY_API_PORT, MACHINES, SENSOR_MAP, SENSORS, SIM_SERVER_URL


async def send_alert_to_sim_server(machine_id: str, risk: float, message: str, reading: Dict[str, float]):
    """Push detected anomaly to the simulation server for the competition."""
    url = f"{SIM_SERVER_URL}/alert"
    sim_reading: Dict[str, float] = {}
    for internal_key, sim_key in SENSOR_MAP.items():
        if internal_key in reading:
            sim_reading[sim_key] = reading[internal_key]

    payload = {
        "machine_id": machine_id,
        "reason": f"AI_DIAGNOSTIC[Risk {risk:.2f}]: {message}",
        "reading": sim_reading,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                if resp.status not in (200, 201):
                    print(f"Failed to post alert to simulation server: HTTP {resp.status}")
    except Exception as exc:
        print(f"Failed to post alert to simulation server: {exc}")


async def agent_loop():
    telemetry_repo = TelemetryRepository(DATABASE_URL)
    telemetry_repo.initialize()
    history_api_runner = await start_history_api(telemetry_repo, HISTORY_API_HOST, HISTORY_API_PORT)
    print(f"📚 History API online at http://{HISTORY_API_HOST}:{HISTORY_API_PORT}/api/history")

    try:
        print("🔭 Calibrating baselines from simulation history...")
        history_df = await load_history()
        baseline_engine = BaselineEngine()
        baseline_engine.train(history_df)

        alert_store = AlertStore()
        detector = AnomalyDetector(baseline_engine, alert_store)

        latest_values: Dict[str, Dict[str, float]] = defaultdict(dict)
        latest_risks: Dict[str, float] = {machine_id: 0.0 for machine_id in MACHINES}
        last_status: Dict[str, str] = {machine_id: "OPERATIONAL" for machine_id in MACHINES}

        print("🚀 Sentinel 4 MISSION CONTROL active. Listening to SSE streams...")
        async for event in stream_live_data():
            machine_id = event.get("machine_id")
            if machine_id not in MACHINES:
                continue

            for sensor_name in SENSORS:
                if sensor_name in event:
                    latest_values[machine_id][sensor_name] = float(event[sensor_name])

            risk, sensor_z = detector.process_reading(event)
            latest_risks[machine_id] = risk

            current_status = normalize_status_label(event.get("status")) or normalize_status_label(
                "critical" if risk >= 0.8 else "warning" if risk >= 0.6 else "running"
            )
            current_risk = risk_from_status(current_status)

            try:
                telemetry_repo.save_reading(event, risk)
                if current_status != last_status[machine_id]:
                    telemetry_repo.log_event(
                        machine_id=machine_id,
                        event_type="status_transition",
                        status=current_status,
                        severity="critical" if current_status == "CRITICAL" else ("warning" if current_status == "WARNING" else "info"),
                        message=f"Status changed from {last_status[machine_id]} to {current_status}",
                        timestamp=event.get("timestamp"),
                        details={
                            "previous_status": last_status[machine_id],
                            "risk": current_risk,
                            "sensor_z": sensor_z,
                            "source_status": event.get("status"),
                        },
                    )
                    last_status[machine_id] = current_status
            except Exception as db_err:
                print(f"Database write failed: {db_err}")

            detector.check_silence()

            alert = alert_store.pop_highest_priority()
            if alert:
                explanation = explain_alert(alert.machine_id, alert.risk, alert.details)
                alert.details["explanation"] = explanation
                alert.details["source_status"] = event.get("status")
                try:
                    telemetry_repo.log_event(
                        machine_id=alert.machine_id,
                        event_type="anomaly_alert",
                        status=normalize_status_label(event.get("status")) or normalize_status_label(
                            "warning" if alert.risk < 0.8 else "critical"
                        ),
                        severity="critical" if alert.risk >= 0.8 else "warning",
                        message=alert.message,
                        details=alert.details,
                    )
                except Exception as db_err:
                    print(f"Database event write failed: {db_err}")

                if alert.risk >= 0.75:
                    await send_alert_to_sim_server(
                        alert.machine_id,
                        alert.risk,
                        explanation,
                        latest_values[alert.machine_id],
                    )

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
    except Exception as exc:
        print(f"\nCRITICAL ERROR: {exc}")
