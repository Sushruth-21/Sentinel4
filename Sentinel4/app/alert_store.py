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
    def __init__(self):
        self._queue: List[Alert] = []
        self.history: List[Alert] = []

    def add_alert(self, machine_id: str, risk: float, message: str, details: dict):
        alert = Alert(risk=risk, timestamp=time.time(), machine_id=machine_id, message=message, details=details)
        heapq.heappush(self._queue, alert)
        self.history.append(alert)

    def pop_highest_priority(self) -> Alert | None:
        if not self._queue:
            return None
        return heapq.heappop(self._queue)

    def get_recent_history(self, limit: int = 50) -> List[Alert]:
        return self.history[-limit:]
