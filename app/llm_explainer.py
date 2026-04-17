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
        "Explain in 2-3 sentences:",
        "1) What is likely happening physically.",
        "2) Which component to inspect first.",
        "3) Whether immediate shutdown is needed or scheduled check is fine.",
    ]
    if is_compound:
        lines.append("Focus on the interaction between sensors, not just single spikes.")
        
    return "\n".join(lines)

def explain_alert(machine_id: str, risk: float, details: dict) -> str:
    if not GROQ_API_KEY:
        # fallback if key missing
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
    
    try:
        resp = requests.post(GROQ_BASE_URL, headers=headers, json=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"]["message"]["content"].strip()
    except Exception as e:
        return f"Could not get explanation from LLM ({e}). Use raw sensor info to decide next steps."
