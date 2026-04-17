import os
from dotenv import load_dotenv

load_dotenv()

# Example moderator URLs (replace with real ones during hackathon)
MODERATOR_HISTORY_CSV = "data/history.csv" # offline dataset
MODERATOR_STREAM_URL = "https://example.com/machines/stream" # SSE or HTTP stream

MACHINES = ["M1", "M2", "M3", "M4"]
SENSORS = ["temperature", "vibration", "rpm", "current"]

# Baseline + anomaly parameters
BASELINE_WINDOW = 500 # how many historical points to use
DRIFT_WINDOW = 20 # rolling mean window for drift
SPIKE_Z_THRESHOLD = 3.0
DRIFT_Z_THRESHOLD = 1.5
SILENCE_SECONDS = 30 # if no data for this time, raise silence alert

# Groq LLM
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.1-8b-instant" # change if needed
