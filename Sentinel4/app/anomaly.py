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
        # For correlation monitoring
        self.corr_buffers: Dict[str, Dict[str, deque]] = defaultdict(
            lambda: {s: deque(maxlen=30) for s in SENSORS} # 30-point window for correlation
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
            self.corr_buffers[machine_id][sensor].append(value)
            
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

        # Calculate specific correlations (e.g., Temp vs Current)
        correlation_bonus = 0.0
        high_correlation_pairs = []
        
        # We check Temp vs Current and Vibration vs Current
        for p1, p2 in [("temperature", "current"), ("vibration", "current")]:
            if len(self.corr_buffers[machine_id][p1]) == 30 and len(self.corr_buffers[machine_id][p2]) == 30:
                v1 = list(self.corr_buffers[machine_id][p1])
                v2 = list(self.corr_buffers[machine_id][p2])
                corr = np.corrcoef(v1, v2)[0, 1]
                
                # If correlation is very high (>0.85) AND one of them is at least slightly elevated
                if corr > 0.85 and (abs(sensor_z.get(p1, 0)) > 1.5 or abs(sensor_z.get(p2, 0)) > 1.5):
                    correlation_bonus += 0.25
                    high_correlation_pairs.append(f"{p1}+{p2}")

        # Compound detection: now requires HIGH correlation OR 2+ strong Z-scores
        warning_sensors = [s for s in SENSORS if spike_flags.get(s) or drift_flags.get(s)]
        is_compound = len(warning_sensors) >= 2 or correlation_bonus > 0

        # risk score components
        if sensor_z:
            z_max = max(abs(z) for z in sensor_z.values())
        else:
            z_max = 0.0

        # Final Risk: requires higher bar to hit 1.0
        # Formula: 40% Max Z-score + 30% Correlation + 30% Persistence
        persistence_factor = 0.3 if any(drift_flags.values()) else 0.0
        
        risk = (z_max / 10.0) * 0.4 + (correlation_bonus) * 0.3 + (persistence_factor)
        risk = min(1.0, risk)

        # simple failure prediction: if high-risk repeated
        if risk >= 0.9:
            self.recent_high_risk_counts[machine_id].append(time.time())
            # if len(self.recent_high_risk_counts[machine_id]) >= 10: 
            if len(self.recent_high_risk_counts[machine_id]) >= 3:
                self.alert_store.add_alert(
                    machine_id=machine_id,
                    risk=0.98,
                    message="Critical persistent failure pattern detected",
                    details={"type": "prediction", "warning_sensors": warning_sensors, "correlations": high_correlation_pairs}
                )

        # create alert when risk high enough
        # if risk >= 0.85: 
        if risk >= 0.70:
            self.alert_store.add_alert(
                machine_id=machine_id,
                risk=risk,
                message="Highly correlated anomaly detected",
                details={
                    "sensor_z": sensor_z,
                    "warning_sensors": warning_sensors,
                    "correlations": high_correlation_pairs,
                    "is_compound": is_compound,
                },
            )

        return risk, sensor_z
