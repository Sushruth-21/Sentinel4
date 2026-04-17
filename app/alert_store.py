import heapq
import time
from dataclasses import dataclass, field
from typing import List

@dataclass(order=True)
class Alert:
    sort_index: float = field(init=False, repr=False)
    risk: float
    timestamp: float
    machine_id: str
    message: str
    details: dict

    def __post_init__(self):
        # higher risk should come first in priority queue
        self.sort_index = -self.risk

class AlertStore:
    def __init__(self, cooldown_seconds: int = 60):
        self._queue: List[Alert] = []
        self.history: List[Alert] = []
        self.cooldown_seconds = cooldown_seconds
        self.last_alert_times = {} # machine_id -> last_timestamp
        self.last_alert_risks = {} # machine_id -> last_risk

    def add_alert(self, machine_id: str, risk: float, message: str, details: dict):
        now = time.time()
        last_time = self.last_alert_times.get(machine_id, 0)
        last_risk = self.last_alert_risks.get(machine_id, 0)
        
        # Cooldown logic: Don't alert if recently told about similar risk
        # Allow alert if:
        # 1. Cooldown has passed
        # 2. OR Risk has significantly increased (>0.1 jump)
        if (now - last_time < self.cooldown_seconds) and (risk - last_risk < 0.1):
            return

        alert = Alert(risk=risk, timestamp=now, machine_id=machine_id, message=message, details=details)
        heapq.heappush(self._queue, alert)
        self.history.append(alert)
        
        self.last_alert_times[machine_id] = now
        self.last_alert_risks[machine_id] = risk

    def pop_highest_priority(self) -> Alert | None:
        if not self._queue:
            return None
        return heapq.heappop(self._queue)

    def get_recent_history(self, limit: int = 50) -> List[Alert]:
        return self.history[-limit:]
