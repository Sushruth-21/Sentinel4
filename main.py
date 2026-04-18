import asyncio
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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
from app.voice_broadcaster import broadcast_voice_alert
from app.status_utils import normalize_status_label, risk_from_status
from config import (
    DATABASE_URL, HISTORY_API_HOST, HISTORY_API_PORT, MACHINES, 
    SENSOR_MAP, SENSORS, SIM_SERVER_URL,
    VOICE_ALERT_COUNT_THRESHOLD, VOICE_ALERT_WINDOW_SECONDS,
    VOICE_CALL_COOLDOWN_SECONDS, GLOBAL_VOICE_COOLDOWN_SECONDS,
    EMAIL_SMTP_SERVER, EMAIL_SMTP_PORT, EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER
)

async def send_maintenance_email(machine_id: str, slot: str, diagnostic: str):
    """Send an automated repair notification email with the maintenance slot and AI diagnostic."""
    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        print("⚠️ Email not configured. Skipping email notification.")
        return

    msg = MIMEMultipart()
    msg['From'] = EMAIL_SENDER
    msg['To'] = EMAIL_RECEIVER
    msg['Subject'] = f"🚨 URGENT: Maintenance Scheduled for {machine_id}"

    body = f"""
    SENTINEL 4 - AUTOMATED MAINTENANCE NOTIFICATION
    ----------------------------------------------
    Machine ID: {machine_id}
    Scheduled Slot: {slot}
    
    AI DIAGNOSTIC:
    {diagnostic}
    
    ACTION REQUIRED:
    Please ensure a technician is available for the assigned slot. 
    Review the tactical dashboard for real-time telemetry.
    
    -- Sentinel 4 Mission Control
    """
    msg.attach(MIMEText(body, 'plain'))

    try:
        with smtplib.SMTP(EMAIL_SMTP_SERVER, EMAIL_SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.send_message(msg)
            print(f"📧 Maintenance notification email sent to {EMAIL_RECEIVER}")
    except Exception as e:
        print(f"❌ Failed to send email: {e}")

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

async def schedule_maintenance(machine_id: str):
    """Automatically book a repair slot on the simulation server (Bonus Feature)."""
    url = f"{SIM_SERVER_URL}/schedule-maintenance"
    payload = {"machine_id": machine_id}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                if resp.status in (200, 201):
                    data = await resp.json()
                    booking = data.get("booking", {})
                    print(f"🔧 [AUTO-BOOK] Maintenance scheduled for {machine_id}. Slot: {booking.get('slot')}")
                    return booking.get("slot")
                else:
                    print(f"Failed to schedule maintenance: HTTP {resp.status}")
    except Exception as exc:
        print(f"Maintenance scheduling error: {exc}")
    return None

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
        
        # Tracking for voice calls and cooldowns
        last_alert_time: Dict[str, float] = {} # Track last alert time per machine
        last_voice_call_time: Dict[str, float] = {} # Track last voice call time per machine
        last_global_voice_call_time: float = 0 # Track last call across all machines
        alert_history: Dict[str, list] = defaultdict(list) # machine_id -> [timestamps]

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

            # try:
            #     # telemetry_repo.save_reading(event, risk) # DISABLED: Unnecessary storage
            #     if current_status != last_status[machine_id]:
            #         telemetry_repo.log_event(
            #             machine_id=machine_id,
            #             event_type="status_transition",
            #             status=current_status,
            #             severity="critical" if current_status == "CRITICAL" else ("warning" if current_status == "WARNING" else "info"),
            #             message=f"Status changed from {last_status[machine_id]} to {current_status}",
            #             timestamp=event.get("timestamp"),
            #             details={
            #                 "previous_status": last_status[machine_id],
            #                 "risk": current_risk,
            #                 "sensor_z": sensor_z,
            #                 "source_status": event.get("status"),
            #             },
            #         )
            #         last_status[machine_id] = current_status
            # except Exception as db_err:
            #     print(f"Database write failed: {db_err}")

            detector.check_silence()

            # Process all pending alerts
            while True:
                alert = alert_store.pop_highest_priority()
                if not alert:
                    break
                
                # 1. Brief explanation for the Web Dashboard and Database
                brief_explanation = explain_alert(alert.machine_id, alert.risk, alert.details, detailed=False)
                alert.details["explanation"] = brief_explanation
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

                current_time = time.time()
                if alert.risk >= 0.4:
                    # mission-wide 10s cooldown for API posting (was 60s)
                    # This keeps the dashboard "Live" while voice is silent.
                    last_sent = last_alert_time.get(alert.machine_id, 0)
                    if current_time - last_sent > 10:
                        await send_alert_to_sim_server(
                            alert.machine_id,
                            alert.risk,
                            brief_explanation,
                            latest_values[alert.machine_id],
                        )
                        last_alert_time[alert.machine_id] = current_time
                        print(f"📢 Dashboard alert sync for {alert.machine_id}")

                    # 2. Voice Call Logic: IMMEDIATELY on correlated anomaly
                    is_correlated = alert.details.get("should_call", False)
                    if is_correlated:
                        last_voice_call = last_voice_call_time.get(alert.machine_id, 0)
                        time_since_last_global = current_time - last_global_voice_call_time
                        
                        if (current_time - last_voice_call > VOICE_CALL_COOLDOWN_SECONDS) and \
                           (time_since_last_global > GLOBAL_VOICE_COOLDOWN_SECONDS):
                            
                            # Detailed diagnostic for phone call
                            detailed_explanation = explain_alert(alert.machine_id, alert.risk, alert.details, detailed=True)
                            broadcast_voice_alert(f"Emergency alert for machine {alert.machine_id}. {detailed_explanation}")
                            
                            # Bonus: Auto-book maintenance slot
                            slot = await schedule_maintenance(alert.machine_id)
                            
                            # New: Send detailed email report
                            if slot:
                                await send_maintenance_email(alert.machine_id, slot, detailed_explanation)

                            last_voice_call_time[alert.machine_id] = current_time
                            last_global_voice_call_time = current_time
                            print(f"📞 IMMEDIATE voice alert triggered for {alert.machine_id}.")
                        else:
                            print(f"🔇 Voice call suppressed by cooldown for {alert.machine_id}")

                if alert_store.history:
                    alert_store.history[-1].details["explanation"] = brief_explanation

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
