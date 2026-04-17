from datetime import datetime
from typing import Optional

from aiohttp import web

from .database import TelemetryRepository
from .status_utils import normalize_status_label


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _with_cors(response: web.StreamResponse) -> web.StreamResponse:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def build_history_app(repo: TelemetryRepository) -> web.Application:
    app = web.Application()

    async def options_handler(_: web.Request) -> web.Response:
        return _with_cors(web.Response(status=204))

    async def get_history(request: web.Request) -> web.Response:
        machine_id = request.query.get("machine_id")
        start = _parse_iso_datetime(request.query.get("start"))
        end = _parse_iso_datetime(request.query.get("end"))
        sort_direction = request.query.get("sort_direction", "desc")
        mode = request.query.get("mode", "timeline")

        try:
            limit = int(request.query.get("limit", "300"))
        except ValueError:
            limit = 300

        try:
            offset = int(request.query.get("offset", "0"))
        except ValueError:
            offset = 0

        if mode == "minute":
            records = repo.list_minute_history(
                machine_id=machine_id or "",
                start=start,
                end=end,
                sort_direction=sort_direction,
                limit=limit,
                offset=offset,
            )
        else:
            records = repo.list_history_timeline(
                machine_id=machine_id,
                start=start,
                end=end,
                sort_direction=sort_direction,
                limit=limit,
                offset=offset,
            )
        return _with_cors(web.json_response({"records": records, "count": len(records)}))

    async def create_event(request: web.Request) -> web.Response:
        try:
            payload = await request.json()
        except Exception:
            return _with_cors(web.json_response({"error": "Invalid JSON payload"}, status=400))

        machine_id = str(payload.get("machine_id") or "").strip()
        event_type = str(payload.get("event_type") or "operation").strip() or "operation"
        status = str(payload.get("status") or "OPERATIONAL").strip() or "OPERATIONAL"
        severity = str(payload.get("severity") or "info").strip() or "info"
        message = str(payload.get("message") or "Machine event").strip() or "Machine event"
        timestamp = payload.get("timestamp")
        details = payload.get("details")

        if not machine_id:
            return _with_cors(web.json_response({"error": "machine_id is required"}, status=400))

        try:
            repo.log_event(
                machine_id=machine_id,
                event_type=event_type,
                status=status,
                severity=severity,
                message=message,
                timestamp=timestamp,
                details=details if isinstance(details, dict) else {},
            )
        except Exception as exc:
            return _with_cors(web.json_response({"error": f"Failed to create event: {exc}"}, status=500))

        return _with_cors(web.json_response({"created": True}))

    async def save_snapshot(request: web.Request) -> web.Response:
        try:
            payload = await request.json()
        except Exception:
            return _with_cors(web.json_response({"error": "Invalid JSON payload"}, status=400))

        machine_id = str(payload.get("machine_id") or "").strip()
        if not machine_id:
            return _with_cors(web.json_response({"error": "machine_id is required"}, status=400))

        event = {
            "timestamp": payload.get("timestamp") or datetime.utcnow().isoformat(),
            "machine_id": machine_id,
            "temperature": payload.get("temperature"),
            "vibration": payload.get("vibration"),
            "rpm": payload.get("rpm"),
            "current": payload.get("current"),
            "source": "manual_snapshot",
            "status": payload.get("status"),
        }
        risk = float(payload.get("risk") or 0.0)

        try:
            repo.save_reading(event, risk)
            repo.log_event(
                machine_id=machine_id,
                event_type="manual_snapshot",
                status=normalize_status_label(payload.get("status")) or "OPERATIONAL",
                severity="info",
                message="Manual snapshot saved from history sidebar",
                timestamp=event["timestamp"],
                details={
                    "temperature": event["temperature"],
                    "vibration": event["vibration"],
                    "rpm": event["rpm"],
                    "current": event["current"],
                    "risk": risk,
                    "status": normalize_status_label(payload.get("status")) or "OPERATIONAL",
                },
            )
        except Exception as exc:
            return _with_cors(web.json_response({"error": f"Failed to save snapshot: {exc}"}, status=500))

        return _with_cors(web.json_response({"saved": True}))

    async def delete_single_history(request: web.Request) -> web.Response:
        record_type = request.match_info.get("record_type", "telemetry")
        raw_id = request.match_info.get("record_id", "")
        try:
            record_id = int(raw_id)
        except ValueError:
            return _with_cors(web.json_response({"error": "Invalid history id"}, status=400))

        if record_type == "event":
            deleted = repo.delete_event_by_id(record_id)
        else:
            deleted = repo.delete_reading_by_id(record_id)
        if not deleted:
            return _with_cors(web.json_response({"error": "History record not found"}, status=404))

        return _with_cors(web.json_response({"deleted": 1, "id": record_id, "record_type": record_type}))

    async def delete_history(request: web.Request) -> web.Response:
        machine_id = request.query.get("machine_id")
        start = _parse_iso_datetime(request.query.get("start"))
        end = _parse_iso_datetime(request.query.get("end"))

        deleted_readings = repo.delete_readings(machine_id=machine_id, start=start, end=end)
        deleted_events = repo.delete_events(machine_id=machine_id, start=start, end=end)
        return _with_cors(web.json_response({"deleted": deleted_readings + deleted_events, "telemetry": deleted_readings, "events": deleted_events}))

    async def get_maintenance_schedule(request: web.Request) -> web.Response:
        machine_id = request.query.get("machine_id")
        try:
            days_ahead = int(request.query.get("days_ahead", "30"))
        except ValueError:
            days_ahead = 30

        try:
            schedule = repo.get_maintenance_schedule(machine_id=machine_id, days_ahead=days_ahead)
        except Exception as exc:
            return _with_cors(web.json_response({"error": f"Failed to get schedule: {exc}"}, status=500))

        return _with_cors(web.json_response({"schedule": schedule, "count": len(schedule)}))

    async def create_maintenance_schedule(request: web.Request) -> web.Response:
        try:
            payload = await request.json()
        except Exception:
            return _with_cors(web.json_response({"error": "Invalid JSON payload"}, status=400))

        machine_id = str(payload.get("machine_id") or "").strip()
        scheduled_date = _parse_iso_datetime(payload.get("scheduled_date"))
        maintenance_type = str(payload.get("maintenance_type") or "scheduled").strip()
        notes = str(payload.get("notes") or "").strip() or None

        if not machine_id:
            return _with_cors(web.json_response({"error": "machine_id is required"}, status=400))
        if not scheduled_date:
            return _with_cors(web.json_response({"error": "scheduled_date is required"}, status=400))

        try:
            maintenance_id = repo.schedule_maintenance(
                machine_id=machine_id,
                scheduled_date=scheduled_date,
                maintenance_type=maintenance_type,
                notes=notes,
            )
        except Exception as exc:
            return _with_cors(web.json_response({"error": f"Failed to schedule maintenance: {exc}"}, status=500))

        return _with_cors(web.json_response({"created": True, "id": maintenance_id}))

    app.router.add_route("OPTIONS", "/api/history", options_handler)
    app.router.add_route("OPTIONS", r"/api/history/{record_type}/{record_id}", options_handler)
    app.router.add_route("OPTIONS", "/api/maintenance/schedule", options_handler)
    app.router.add_get("/api/history", get_history)
    app.router.add_post("/api/history/events", create_event)
    app.router.add_post("/api/history/snapshot", save_snapshot)
    app.router.add_delete("/api/history", delete_history)
    app.router.add_delete(r"/api/history/{record_type}/{record_id}", delete_single_history)
    app.router.add_get("/api/maintenance/schedule", get_maintenance_schedule)
    app.router.add_post("/api/maintenance/schedule", create_maintenance_schedule)

    return app


async def start_history_api(repo: TelemetryRepository, host: str, port: int) -> web.AppRunner:
    app = build_history_app(repo)
    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, host=host, port=port)
    await site.start()
    return runner
