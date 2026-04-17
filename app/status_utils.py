from __future__ import annotations

from typing import Any


def normalize_status_label(raw_status: Any) -> str:
    value = str(raw_status or "").strip().lower()
    if not value:
        return ""

    if value in {"fault", "critical", "crit"}:
        return "CRITICAL"
    if value in {"warning", "warn"}:
        return "WARNING"
    if value in {"running", "operational", "stable", "ok", "normal"}:
        return "OPERATIONAL"
    if value in {"maintenance", "maint"}:
        return "MAINTENANCE"
    return value.upper()


def status_rank(status: Any) -> int:
    normalized = normalize_status_label(status)
    order = {
        "OPERATIONAL": 0,
        "MAINTENANCE": 1,
        "WARNING": 2,
        "CRITICAL": 3,
    }
    return order.get(normalized, 0)


def risk_from_status(status: Any) -> float:
    normalized = normalize_status_label(status)
    if normalized == "CRITICAL":
        return 0.9
    if normalized == "WARNING":
        return 0.65
    if normalized == "MAINTENANCE":
        return 0.05
    return 0.15
