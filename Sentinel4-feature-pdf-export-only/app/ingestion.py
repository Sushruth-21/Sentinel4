import asyncio
import aiohttp
import pandas as pd
from typing import AsyncIterator, Dict, Any, List
import json
from config import SIM_SERVER_URL, MACHINES, SENSOR_MAP, SENSORS

async def fetch_history_for_machine(session: aiohttp.ClientSession, machine_id: str) -> List[Dict[str, Any]]:
    """Fetch history from simulation server for a specific machine."""
    url = f"{SIM_SERVER_URL}/history/{machine_id}"
    try:
        async with session.get(url) as resp:
            if resp.status == 200:
                data = await resp.json()
                return data.get("history", [])
    except Exception as e:
        print(f"Error fetching history for {machine_id}: {e}")
    return []

async def load_history() -> pd.DataFrame:
    """Load historical data from simulation server REST API."""
    all_readings = []
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_history_for_machine(session, m) for m in MACHINES]
        results = await asyncio.gather(*tasks)
        for machine_results in results:
            for r in machine_results:
                # Map simulation keys back to internal Sentinel 4 keys
                mapped = {
                    "timestamp": r.get("timestamp"),
                    "machine_id": r.get("machine_id"),
                }
                for internal_key, sim_key in SENSOR_MAP.items():
                    mapped[internal_key] = r.get(sim_key)
                all_readings.append(mapped)
    
    if not all_readings:
        return pd.DataFrame(columns=["timestamp", "machine_id"] + SENSORS)
    
    return pd.DataFrame(all_readings)

async def stream_single_machine(session: aiohttp.ClientSession, machine_id: str, queue: asyncio.Queue):
    """Listen to an SSE stream for one machine and put events in a shared queue."""
    url = f"{SIM_SERVER_URL}/stream/{machine_id}"
    while True:
        try:
            async with session.get(url) as resp:
                async for line in resp.content:
                    line = line.decode('utf-8').strip()
                    if line.startswith('data:'):
                        data_str = line[5:].strip()
                        if not data_str:
                            continue
                        data = json.loads(data_str)
                        # Map keys
                        mapped = {
                            "timestamp": data.get("timestamp"),
                            "machine_id": data.get("machine_id"),
                        }
                        for internal_key, sim_key in SENSOR_MAP.items():
                            mapped[internal_key] = data.get(sim_key)
                        await queue.put(mapped)
        except Exception as e:
            print(f"Stream error for {machine_id}: {e}. Retrying in 5s...")
            await asyncio.sleep(5)

async def stream_live_data() -> AsyncIterator[Dict[str, Any]]:
    """Aggregated stream combining SSE sources from all machines."""
    queue = asyncio.Queue()
    async with aiohttp.ClientSession() as session:
        # Start listeners for each machine
        for machine_id in MACHINES:
            asyncio.create_task(stream_single_machine(session, machine_id, queue))
        
        while True:
            event = await queue.get()
            yield event
