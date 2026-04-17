import os
from dotenv import load_dotenv

load_dotenv()

# Simulation Server Integration
SIM_SERVER_URL = os.getenv("SIM_SERVER_URL", "http://localhost:3000")
MODERATOR_HISTORY_CSV = "data/history.csv" # Still keep for fallback
# DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///data/sentinel4.db")
# Moved to user home to avoid frontend live-reload loops
DATABASE_URL = "sqlite:///" + os.path.join(os.path.expanduser("~"), "sentinel4_telemetry.db")
HISTORY_API_HOST = os.getenv("HISTORY_API_HOST", "127.0.0.1")
HISTORY_API_PORT = int(os.getenv("HISTORY_API_PORT", "8010"))

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
BASELINE_WINDOW = 1000 
DRIFT_WINDOW = 50 
SPIKE_Z_THRESHOLD = 3.0 
DRIFT_Z_THRESHOLD = 2.0
SILENCE_SECONDS = 60 

# Groq LLM
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.1-8b-instant"

# Twilio Configuration
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
TWILIO_TO_NUMBER = os.getenv("TWILIO_TO_NUMBER", "") 

# Voice Alert Logic
VOICE_ALERT_COUNT_THRESHOLD = 5 
VOICE_ALERT_WINDOW_SECONDS = 300 
VOICE_CALL_COOLDOWN_SECONDS = 600 
GLOBAL_VOICE_COOLDOWN_SECONDS = 120 
