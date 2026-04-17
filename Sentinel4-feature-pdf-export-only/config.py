import os
from dotenv import load_dotenv

load_dotenv()

# Simulation Server Integration
SIM_SERVER_URL = "http://localhost:3000"
MODERATOR_HISTORY_CSV = "data/history.csv" # Still keep for fallback

MACHINES = ["CNC_01", "CNC_02", "PUMP_03", "CONVEYOR_04"]
# Map internal sensor names to simulation server keys
SENSOR_MAP = {
    "temperature": "temperature_C",
    "vibration": "vibration_mm_s",
    "rpm": "rpm",
    "current": "current_A"
}
SENSORS = list(SENSOR_MAP.keys())

# Baseline + anomaly parameters
BASELINE_WINDOW = 500 
DRIFT_WINDOW = 20 
SPIKE_Z_THRESHOLD = 3.2 # Slightly more conservative
DRIFT_Z_THRESHOLD = 1.8
SILENCE_SECONDS = 30 

# Groq LLM
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.1-8b-instant"
