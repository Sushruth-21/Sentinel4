import os
import requests
from config import GROQ_API_KEY, GROQ_MODEL

GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"

def build_prompt(machine_id: str, risk: float, details: dict) -> str:
    sensor_z = details.get("sensor_z", {})
    warning_sensors = details.get("warning_sensors", [])
    is_compound = details.get("is_compound", False)
    
    lines = [
        f"You are an industrial maintenance expert.",
        f"Machine: {machine_id}",
        f"Risk score: {risk:.2f}",
        f"Warning sensors: {', '.join(warning_sensors) or 'none'}",
        f"Z-scores: {sensor_z}",
        "Explain briefly:",
        "1. Physical cause.",
        "2. Primary check-point.",
        "3. Urgency (Shutdown/Check).",
    ]
    if is_compound:
        lines.append("Focus on the interaction between sensors, not just single spikes.")
        
    return "\n".join(lines)

import time
import random

def explain_alert(machine_id: str, risk: float, details: dict) -> str:
    if not GROQ_API_KEY:
        return "LLM not configured. Check coolant and mechanical parts based on high sensor values."
        
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    
    prompt = build_prompt(machine_id, risk, details)
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You explain machine anomalies simply for engineers."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 200,
    }
    
    max_retries = 3
    base_delay = 2 # seconds
    
    for attempt in range(max_retries):
        try:
            resp = requests.post(GROQ_BASE_URL, headers=headers, json=payload, timeout=10)
            
            if resp.status_code == 429:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                time.sleep(delay)
                continue
                
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()
            
        except Exception as e:
            if attempt == max_retries - 1:
                return f"Could not get explanation from LLM ({e}). Use raw sensor info to decide next steps."
            time.sleep(1)
            
    return "LLM explanation timed out. Check mechanical stability."
