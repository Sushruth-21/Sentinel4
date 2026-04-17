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
        "Task: Explain the most likely physical cause in ONE short sentence.",
        "Be extremely concise. Do not use filler words."
    ]
    if is_compound:
        lines.append("Focus on the multi-sensor correlation.")
        
    return "\n".join(lines)

def explain_alert(machine_id: str, risk: float, details: dict) -> str:
    if not GROQ_API_KEY:
        # fallback if key missing
        return "Anomaly detected. Check mechanical and thermal components."
        
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    
    prompt = build_prompt(machine_id, risk, details)
    
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are a concise industrial diagnostic assistant. Reply in one short sentence maximum."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 80,
    }
    
    try:
        resp = requests.post(GROQ_BASE_URL, headers=headers, json=payload, timeout=7)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"Anomaly detected. Diagnostic unavailable ({e})."
