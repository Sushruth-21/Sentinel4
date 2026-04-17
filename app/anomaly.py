import time
from collections import defaultdict, deque
from typing import Dict, Any, Tuple
import numpy as np
from config import (
    MACHINES,
    SENSORS,
    SPIKE_Z_THRESHOLD,
    DRIFT_Z_THRESHOLD,
    DRIFT_WINDOW,
    SILENCE_SECONDS,
)
from .baseline import BaselineEngine
from .alert_store import AlertStore

class AnomalyDetector:
    def __init__(self, baseline_engine: BaselineEngine, alert_store: AlertStore):
        self.baseline_engine = baseline_engine
        self.alert_store = alert_store
        # For drift detection
        self.recent_values: Dict[str, Dict[str, deque]] = defaultdict(
            lambda: {s: deque(maxlen=DRIFT_WINDOW) for s in SENSORS}
        )
        # For silence detection
        self.last_seen: Dict[str, float] = {m: time.time() for m in MACHINES}
        # For simple failure prediction (count high-risk events)
        self.recent_high_risk_counts: Dict[str, deque] = {
            m: deque(maxlen=10) for m in MACHINES
        }

    def update_last_seen(self, machine_id: str):
        self.last_seen[machine_id] = time.time()

    def check_silence(self):
        now = time.time()
        for m in MACHINES:
            if now - self.last_seen[m] > SILENCE_SECONDS:
                self.alert_store.add_alert(
                    machine_id=m,
                    risk=0.7,
                    message="Silence detected: no data for machine",
                    details={"type": "silence"},
                )
                # reset to avoid spamming
                self.last_seen[m] = now

    def _z_score(self, value: float, mean: float, std: float) -> float:
        return 0.0 if std == 0 else (value - mean) / std

    def process_reading(self, event: Dict[str, Any]) -> Tuple[float, Dict[str, float]]:
        """Process one event and return (risk, sensor_z_scores)."""
        machine_id = event.get("machine_id")
        if machine_id not in MACHINES:
            return 0.0, {}

        self.update_last_seen(machine_id)
        sensor_z = {}
        spike_flags = {}
        drift_flags = {}

        for sensor in SENSORS:
            if sensor not in event:
                continue
            
            value = float(event[sensor])
            self.baseline_engine.add_history(machine_id, sensor, value)
            mean, std = self.baseline_engine.get_baseline(machine_id, sensor)
            
            z = self._z_score(value, mean, std)
            sensor_z[sensor] = z
            
            # spike detection
            spike_flags[sensor] = abs(z) >= SPIKE_Z_THRESHOLD
            
            # drift detection – update rolling window
            self.recent_values[machine_id][sensor].append(value)
            rv = list(self.recent_values[machine_id][sensor])
            if len(rv) == DRIFT_WINDOW:
                arr = np.array(rv)
                rolling_mean = arr.mean()
                drift_z = self._z_score(rolling_mean, mean, std)
                drift_flags[sensor] = abs(drift_z) >= DRIFT_Z_THRESHOLD
            else:
                drift_flags[sensor] = False

        # compound detection: 2+ sensors in warning (spike or drift)
        warning_sensors = [s for s in SENSORS if spike_flags.get(s) or drift_flags.get(s)]
        is_compound = len(warning_sensors) >= 2

        # risk score components
        if sensor_z:
            z_max = max(abs(z) for z in sensor_z.values())
        else:
            z_max = 0.0

        compound_bonus = 0.5 if is_compound else 0.0
        # simple duration factor: based on number of consecutive warnings
        duration_factor = 0.3 if any(drift_flags.values()) else 0.0
        
        risk = min(1.0, z_max * 0.5 + compound_bonus * 0.3 + duration_factor * 0.2)

        # simple failure prediction: if high-risk repeated
        if risk >= 0.8:
            self.recent_high_risk_counts[machine_id].append(time.time())
            if len(self.recent_high_risk_counts[machine_id]) >= 3:
                self.alert_store.add_alert(
                    machine_id=machine_id,
                    risk=0.95,
                    message="Failure likely soon if pattern continues",
                    details={"type": "prediction", "warning_sensors": warning_sensors}
                )

        # create alert when risk high enough
        if risk >= 0.6:
            self.alert_store.add_alert(
                machine_id=machine_id,
                risk=risk,
                message="Anomaly detected",
                details={
                    "sensor_z": sensor_z,
                    "warning_sensors": warning_sensors,
                    "is_compound": is_compound,
                },
            )

        return risk, sensor_z
