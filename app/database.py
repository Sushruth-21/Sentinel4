import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import DateTime, Float, Integer, String, Text, create_engine, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class TelemetryReading(Base):
    __tablename__ = "telemetry_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    machine_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vibration: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rpm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    risk: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)


class MachineEvent(Base):
    __tablename__ = "machine_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    machine_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")


class TelemetryRepository:
    def __init__(self, database_url: str):
        self.database_url = self._normalize_database_url(database_url)
        self.engine = create_engine(self.database_url, future=True, pool_pre_ping=True)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, future=True)

    def _normalize_database_url(self, url: str) -> str:
        # Ensure local sqlite folders exist when using a relative sqlite path.
        if not url.startswith("sqlite:///"):
            return url

        sqlite_path = url.replace("sqlite:///", "", 1)
        if sqlite_path == ":memory:":
            return url

        if not os.path.isabs(sqlite_path):
            sqlite_path = os.path.join(os.getcwd(), sqlite_path)

        os.makedirs(os.path.dirname(sqlite_path), exist_ok=True)
        return f"sqlite:///{sqlite_path}"

    def initialize(self) -> None:
        Base.metadata.create_all(self.engine)

    def save_reading(self, event: Dict[str, Any], risk: float) -> None:
        reading = TelemetryReading(
            timestamp=self._parse_timestamp(event.get("timestamp")),
            machine_id=event.get("machine_id", "UNKNOWN"),
            temperature=self._to_float(event.get("temperature")),
            vibration=self._to_float(event.get("vibration")),
            rpm=self._to_float(event.get("rpm")),
            current=self._to_float(event.get("current")),
            risk=float(risk),
            payload_json=json.dumps(event, default=str),
        )

        with self.session_factory() as session:
            try:
                session.add(reading)
                session.commit()
            except Exception:
                session.rollback()
                raise

    def log_event(
        self,
        machine_id: str,
        event_type: str,
        status: str,
        severity: str,
        message: str,
        timestamp: Any = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        machine_event = MachineEvent(
            timestamp=self._parse_timestamp(timestamp),
            machine_id=machine_id,
            event_type=event_type,
            status=status,
            severity=severity,
            message=message,
            details_json=json.dumps(details or {}, default=str),
        )

        with self.session_factory() as session:
            try:
                session.add(machine_event)
                session.commit()
            except Exception:
                session.rollback()
                raise

    def list_history_timeline(
        self,
        machine_id: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        sort_direction: str = "desc",
        limit: int = 500,
        offset: int = 0,
    ) -> list[Dict[str, Any]]:
        telemetry_rows = self.list_readings(
            machine_id=machine_id,
            start=start,
            end=end,
            sort_by="timestamp",
            sort_direction=sort_direction,
            limit=max(1, min(limit, 3000)),
            offset=offset,
        )

        with self.session_factory() as session:
            query = select(MachineEvent)
            if machine_id:
                query = query.where(MachineEvent.machine_id == machine_id)
            if start is not None:
                query = query.where(MachineEvent.timestamp >= start)
            if end is not None:
                query = query.where(MachineEvent.timestamp <= end)

            if sort_direction == "asc":
                query = query.order_by(MachineEvent.timestamp.asc())
            else:
                query = query.order_by(MachineEvent.timestamp.desc())

            safe_limit = max(1, min(limit, 3000))
            safe_offset = max(0, offset)
            event_rows = session.execute(query.offset(safe_offset).limit(safe_limit)).scalars().all()

        timeline = [
            {
                "id": row["id"],
                "record_type": "telemetry",
                "timestamp": row["timestamp"],
                "machine_id": row["machine_id"],
                "status": self._status_from_risk(float(row.get("risk") or 0.0)),
                "severity": "critical" if float(row.get("risk") or 0.0) >= 0.8 else ("warning" if float(row.get("risk") or 0.0) >= 0.6 else "normal"),
                "event_type": "telemetry",
                "message": "Telemetry sample captured",
                "temperature": row.get("temperature"),
                "vibration": row.get("vibration"),
                "rpm": row.get("rpm"),
                "current": row.get("current"),
                "risk": row.get("risk"),
                "payload": row.get("payload") or {},
            }
            for row in telemetry_rows
        ]

        for event_row in event_rows:
            timeline.append(self._serialize_event(event_row))

        timeline.sort(key=lambda r: r.get("timestamp", ""), reverse=(sort_direction != "asc"))
        safe_limit = max(1, min(limit, 3000))
        return timeline[:safe_limit]

    def list_minute_history(
        self,
        machine_id: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        sort_direction: str = "desc",
        limit: int = 500,
        offset: int = 0,
    ) -> list[Dict[str, Any]]:
        if not machine_id:
            return []

        # Pull enough rows to build grouped minute summaries.
        readings = self.list_readings(
            machine_id=machine_id,
            start=start,
            end=end,
            sort_by="timestamp",
            sort_direction="asc",
            limit=10000,
            offset=0,
        )

        minute_buckets: Dict[str, Dict[str, Any]] = {}

        for row in readings:
            raw_ts = row.get("timestamp")
            parsed_ts = self._parse_timestamp(raw_ts)
            minute_ts = parsed_ts.replace(second=0, microsecond=0)
            minute_key = minute_ts.isoformat()

            bucket = minute_buckets.get(minute_key)
            if bucket is None:
                bucket = {
                    "id": f"{machine_id}|{minute_key}",
                    "record_type": "minute",
                    "event_type": "minute_summary",
                    "timestamp": minute_key,
                    "minute_start": minute_key,
                    "minute_end": (minute_ts + timedelta(minutes=1) - timedelta(seconds=1)).isoformat(),
                    "machine_id": machine_id,
                    "status": "OPERATIONAL",
                    "severity": "normal",
                    "message": "1-minute machine summary",
                    "temperature": 0.0,
                    "vibration": 0.0,
                    "rpm": 0.0,
                    "current": 0.0,
                    "risk": 0.0,
                    "temperature_min": float("inf"),
                    "temperature_max": float("-inf"),
                    "vibration_min": float("inf"),
                    "vibration_max": float("-inf"),
                    "rpm_min": float("inf"),
                    "rpm_max": float("-inf"),
                    "current_min": float("inf"),
                    "current_max": float("-inf"),
                    "risk_min": float("inf"),
                    "risk_max": float("-inf"),
                    "sample_count": 0,
                    "payload": {},
                    "_last_sample_ts": "",
                }
                minute_buckets[minute_key] = bucket

            temperature = float(row.get("temperature") or 0.0)
            vibration = float(row.get("vibration") or 0.0)
            rpm = float(row.get("rpm") or 0.0)
            current = float(row.get("current") or 0.0)
            risk = float(row.get("risk") or 0.0)

            bucket["temperature_min"] = min(bucket["temperature_min"], temperature)
            bucket["temperature_max"] = max(bucket["temperature_max"], temperature)
            bucket["vibration_min"] = min(bucket["vibration_min"], vibration)
            bucket["vibration_max"] = max(bucket["vibration_max"], vibration)
            bucket["rpm_min"] = min(bucket["rpm_min"], rpm)
            bucket["rpm_max"] = max(bucket["rpm_max"], rpm)
            bucket["current_min"] = min(bucket["current_min"], current)
            bucket["current_max"] = max(bucket["current_max"], current)
            bucket["risk_min"] = min(bucket["risk_min"], risk)
            bucket["risk_max"] = max(bucket["risk_max"], risk)
            bucket["sample_count"] += 1

            row_ts = str(row.get("timestamp") or "")
            if row_ts >= bucket["_last_sample_ts"]:
                bucket["_last_sample_ts"] = row_ts
                bucket["temperature"] = temperature
                bucket["vibration"] = vibration
                bucket["rpm"] = rpm
                bucket["current"] = current
                bucket["risk"] = risk

        # Apply status events inside each minute window if available.
        with self.session_factory() as session:
            query = select(MachineEvent).where(MachineEvent.machine_id == machine_id)
            if start is not None:
                query = query.where(MachineEvent.timestamp >= start)
            if end is not None:
                query = query.where(MachineEvent.timestamp <= end)
            query = query.order_by(MachineEvent.timestamp.asc())
            event_rows = session.execute(query).scalars().all()

        for event_row in event_rows:
            minute_key = event_row.timestamp.replace(second=0, microsecond=0).isoformat()
            bucket = minute_buckets.get(minute_key)
            if not bucket:
                continue
            bucket["status"] = event_row.status or bucket["status"]
            bucket["severity"] = event_row.severity or bucket["severity"]
            bucket["message"] = event_row.message or bucket["message"]
            bucket["payload"] = {
                "event_type": event_row.event_type,
                "status": event_row.status,
                "severity": event_row.severity,
                "message": event_row.message,
            }

        summaries = []
        for bucket in minute_buckets.values():
            if bucket["sample_count"] <= 0:
                continue

            # If no explicit event status was present for that minute, derive from max risk.
            if bucket["status"] in ("", "OPERATIONAL"):
                bucket["status"] = self._status_from_risk(float(bucket["risk_max"]))
                bucket["severity"] = "critical" if bucket["risk_max"] >= 0.8 else ("warning" if bucket["risk_max"] >= 0.6 else "normal")

            # Replace sentinel values in case of sparse data.
            for key in [
                "temperature_min", "temperature_max",
                "vibration_min", "vibration_max",
                "rpm_min", "rpm_max",
                "current_min", "current_max",
                "risk_min", "risk_max",
            ]:
                if bucket[key] == float("inf") or bucket[key] == float("-inf"):
                    bucket[key] = 0.0

            bucket.pop("_last_sample_ts", None)
            summaries.append(bucket)

        summaries.sort(key=lambda r: r.get("minute_start", ""), reverse=(sort_direction != "asc"))
        safe_offset = max(0, offset)
        safe_limit = max(1, min(limit, 3000))
        return summaries[safe_offset:safe_offset + safe_limit]

    def list_readings(
        self,
        machine_id: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        sort_by: str = "timestamp",
        sort_direction: str = "desc",
        limit: int = 300,
        offset: int = 0,
    ) -> list[Dict[str, Any]]:
        with self.session_factory() as session:
            query = select(TelemetryReading)

            if machine_id:
                query = query.where(TelemetryReading.machine_id == machine_id)
            if start is not None:
                query = query.where(TelemetryReading.timestamp >= start)
            if end is not None:
                query = query.where(TelemetryReading.timestamp <= end)

            sortable_fields = {
                "timestamp": TelemetryReading.timestamp,
                "risk": TelemetryReading.risk,
                "machine_id": TelemetryReading.machine_id,
            }
            sort_column = sortable_fields.get(sort_by, TelemetryReading.timestamp)
            if sort_direction == "asc":
                query = query.order_by(sort_column.asc())
            else:
                query = query.order_by(sort_column.desc())

            safe_limit = max(1, min(limit, 2000))
            safe_offset = max(0, offset)
            query = query.offset(safe_offset).limit(safe_limit)

            rows = session.execute(query).scalars().all()
            return [self._serialize_reading(row) for row in rows]

    def delete_reading_by_id(self, reading_id: int) -> bool:
        with self.session_factory() as session:
            row = session.get(TelemetryReading, reading_id)
            if row is None:
                return False
            session.delete(row)
            session.commit()
            return True

    def delete_readings(
        self,
        machine_id: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
    ) -> int:
        with self.session_factory() as session:
            stmt = delete(TelemetryReading)
            if machine_id:
                stmt = stmt.where(TelemetryReading.machine_id == machine_id)
            if start is not None:
                stmt = stmt.where(TelemetryReading.timestamp >= start)
            if end is not None:
                stmt = stmt.where(TelemetryReading.timestamp <= end)

            result = session.execute(stmt)
            session.commit()
            return int(result.rowcount or 0)

    def delete_event_by_id(self, event_id: int) -> bool:
        with self.session_factory() as session:
            row = session.get(MachineEvent, event_id)
            if row is None:
                return False
            session.delete(row)
            session.commit()
            return True

    def delete_events(
        self,
        machine_id: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
    ) -> int:
        with self.session_factory() as session:
            stmt = delete(MachineEvent)
            if machine_id:
                stmt = stmt.where(MachineEvent.machine_id == machine_id)
            if start is not None:
                stmt = stmt.where(MachineEvent.timestamp >= start)
            if end is not None:
                stmt = stmt.where(MachineEvent.timestamp <= end)

            result = session.execute(stmt)
            session.commit()
            return int(result.rowcount or 0)

    def _serialize_reading(self, row: TelemetryReading) -> Dict[str, Any]:
        payload = {}
        try:
            payload = json.loads(row.payload_json) if row.payload_json else {}
        except json.JSONDecodeError:
            payload = {}

        return {
            "id": row.id,
            "timestamp": row.timestamp.isoformat(),
            "machine_id": row.machine_id,
            "temperature": row.temperature,
            "vibration": row.vibration,
            "rpm": row.rpm,
            "current": row.current,
            "risk": row.risk,
            "payload": payload,
        }

    def _serialize_event(self, row: MachineEvent) -> Dict[str, Any]:
        details: Dict[str, Any] = {}
        try:
            details = json.loads(row.details_json) if row.details_json else {}
        except json.JSONDecodeError:
            details = {}

        return {
            "id": row.id,
            "record_type": "event",
            "timestamp": row.timestamp.isoformat(),
            "machine_id": row.machine_id,
            "status": row.status,
            "severity": row.severity,
            "event_type": row.event_type,
            "message": row.message,
            "temperature": details.get("temperature"),
            "vibration": details.get("vibration"),
            "rpm": details.get("rpm"),
            "current": details.get("current"),
            "risk": details.get("risk"),
            "payload": details,
        }

    def _status_from_risk(self, risk: float) -> str:
        if risk >= 0.8:
            return "CRITICAL"
        if risk >= 0.6:
            return "WARNING"
        return "OPERATIONAL"

    def _parse_timestamp(self, raw_timestamp: Any) -> datetime:
        if isinstance(raw_timestamp, datetime):
            return raw_timestamp

        if isinstance(raw_timestamp, str) and raw_timestamp:
            candidate = raw_timestamp.replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(candidate)
                # Store naive UTC in DB for portability.
                if parsed.tzinfo is not None:
                    return parsed.astimezone(timezone.utc).replace(tzinfo=None)
                return parsed
            except ValueError:
                pass

        return datetime.utcnow()

    def _to_float(self, value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
