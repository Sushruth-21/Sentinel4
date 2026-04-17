from collections import defaultdict, deque
from typing import Dict, Deque, Tuple
import numpy as np
from config import MACHINES, SENSORS, BASELINE_WINDOW

class BaselineEngine:
    def __init__(self):
        # history[machine][sensor] = deque of recent values
        self.history: Dict[str, Dict[str, Deque[float]]] = defaultdict(
            lambda: {s: deque(maxlen=BASELINE_WINDOW) for s in SENSORS}
        )

    def add_history(self, machine_id: str, sensor: str, value: float):
        if machine_id not in MACHINES or sensor not in SENSORS:
            return
        self.history[machine_id][sensor].append(float(value))

    def get_baseline(self, machine_id: str, sensor: str) -> Tuple[float, float]:
        """Return (mean, std) for given machine+sensor."""
        values = list(self.history[machine_id][sensor])
        if len(values) < 10:
            return 0.0, 1.0 # avoids division by zero, treated as "not enough history"
        arr = np.array(values)
        return float(arr.mean()), float(arr.std() or 1.0)
