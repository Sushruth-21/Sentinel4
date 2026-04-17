import asyncio
import aiohttp
import pandas as pd
from typing import AsyncIterator, Dict, Any
import json
from config import MODERATOR_HISTORY_CSV, MODERATOR_STREAM_URL, MACHINES, SENSORS

def load_history() -> pd.DataFrame:
    """Load historical data from CSV provided by moderators."""
    df = pd.read_csv(MODERATOR_HISTORY_CSV)
    # Expecting columns: timestamp, machine_id, sensor, value
    return df

async def stream_live_data() -> AsyncIterator[Dict[str, Any]]:
    """Connect to moderator SSE/HTTP stream and yield readings."""
    async with aiohttp.ClientSession() as session:
        async with session.get(MODERATOR_STREAM_URL) as resp:
            async for line in resp.content:
                try:
                    text = line.decode().strip()
                    if not text:
                        continue
                    # Here you parse JSON from SSE/HTTP (adjust after seeing API)
                    event = json.loads(text)
                    yield event
                except Exception:
                    # Ignore malformed lines
                    continue

async def fake_stream_from_history(delay: float = 0.5) -> AsyncIterator[Dict[str, Any]]:
    """Fallback: generate a fake live stream from history CSV."""
    df = load_history()
    for _, row in df.iterrows():
        event = {
            "timestamp": row["timestamp"],
            "machine_id": row["machine_id"],
        }
        for sensor in SENSORS:
            if sensor in df.columns:
                event[sensor] = row[sensor]
        yield event
        await asyncio.sleep(delay)
