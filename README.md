# Sentinel 4 - Industrial AI Monitoring System

Sentinel 4 is a high-performance industrial monitoring system designed for predictive maintenance. It combines real-time multi-sensor data ingestion with an autonomous AI agent that detects anomalies, predicts mechanical failures, and provides LLM-generated explanations for maintenance engineers.

## Key Features

- **Autonomous Agent Loop**: Continuous monitoring of machine health with real-time risk assessment.
- **Three-Tier Anomaly Detection**:
    - **Spike Detection**: Immediate identification of sensor outliers.
    - **Drift Detection**: Captures slow degradation patterns over time.
    - **Compound Logic**: High-risk alerts triggered by multi-sensor instability.
- **Predictive Diagnostics**: Forecasts potential failures before they occur, reducing downtime.
- **AI Explanation Layer**: Powered by Groq/Llama 3.1, providing human-readable explanations and action items for every alert.
- **Industrial Neon Noir Dashboard**: A modern, responsive web interface for control rooms and field engineers.

## System Architecture

### Backend Agent
- `app/ingestion.py`: Handles data streams (CSV history or Live SSE).
- `app/baseline.py`: Dynamically learns "normal" operating ranges for every machine.
- `app/anomaly.py`: The detection brain implementing Z-score and rolling mean logic.
- `app/llm_explainer.py`: Integration with Groq API for expert diagnostic advice.

### Frontend Dashboard
The frontend is a standalone responsive web application located in the `frontend/` directory.
- `index.html`: Multi-view layout (Overview & Diagnostics).
- `styles.css`: High-fidelity Industrial aesthetic with responsive breakpoints.
- `app.js`: Dynamic UI updates and state management.

## Setup & Usage

### Prerequisites
- Python 3.8+
- Groq API Key (for LLM explanations)

### Installation
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Configure environment:
   Create a `.env` file or export your key:
   ```bash
   export GROQ_API_KEY=your_key_here
   ```

### Running the System
1. **Start the Backend Agent**:
   ```bash
   python main.py
   ```
2. **Launch the Dashboard**:
   Open `frontend/index.html` in any modern web browser.

## Technical Details

- **Language**: Python (Backend), Javascript/CSS/HTML (Frontend)
- **Primary Libraries**: `aiohttp`, `pandas`, `numpy`, `rich` (Terminal output).
- **Frontend Design**: Vanilla CSS with a focus on high information scent and spatial clarity.
