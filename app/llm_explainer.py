import os
import requests
import time
import random
from config import GROQ_API_KEY, GROQ_MODEL

GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"

def build_prompt(machine_id: str, risk: float, details: dict) -> str:
    sensor_z = details.get("sensor_z", {})
    warning_sensors = details.get("warning_sensors", [])
    
    lines = [
        f"You are an industrial maintenance expert.",
        f"Machine: {machine_id}",
        f"Risk score: {risk:.2f}",
        f"Warning sensors: {', '.join(warning_sensors) or 'none'}",
        f"Z-scores: {sensor_z}",
        "Task: Explain the most likely physical cause in ONE short sentence.",
        "Be extremely concise. Do not use filler words."
    ]
    return "\n".join(lines)

def explain_alert(machine_id: str, risk: float, details: dict, detailed: bool = False) -> str:
    if not GROQ_API_KEY:
        return "Anomaly detected. Check mechanical and thermal components."
        
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    
    if detailed:
        # Detailed, natural prompt for voice calls
        prompt = (
            f"You are a senior industrial engineer. Machine {machine_id} has a risk of {risk:.2f}. "
            f"Sensor anomalies: {details.get('sensor_z')}. Warning sensors: {details.get('warning_sensors')}. "
            f"Correlations: {details.get('correlations')}. "
            f"Explain in 3 clear sentences: 1) The likely physical failure, 2) The exact component to inspect, "
            f"and 3) A warning about what happens if ignored. Speak naturally for a phone call."
        )
        max_tokens = 150
        system_msg = "You provide detailed, natural-sounding industrial diagnostics. Reply in maximum 3 sentences."
    else:
        # Existing concise web dashboard alert
        prompt = build_prompt(machine_id, risk, details)
        max_tokens = 80
        system_msg = "You are a concise industrial diagnostic assistant. Reply in one short sentence maximum."

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2 if detailed else 0.1,
        "max_tokens": max_tokens,
    }
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            resp = requests.post(GROQ_BASE_URL, headers=headers, json=payload, timeout=12)
            if resp.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            if attempt == max_retries - 1:
                return f"Anomaly detected on {machine_id}. Physical inspection required."
            time.sleep(1)
            
    return f"Anomaly detected on {machine_id}. Inspection required."
