# Sentinel 4 - Industrial AI Monitoring System

Sentinel 4 is a high-fidelity industrial monitoring system designed for the **Hack Malnadu 2026** competition. It transforms raw sensor data into actionable intelligence through a combination of statistical anomaly detection, predictive failure modeling, and LLM-powered diagnostics.

## 🚀 Key Features

- **Tactical Mission Control**: A professional-grade "Industrial Neon Noir" dashboard providing sub-second telemetry visualization.
- **Autonomous Anomaly Brain**:
    - **Spike Detection**: Real-time identification of sensor outliers using Z-score logic.
    - **Drift Detection**: Captures slow mechanical degradation patterns.
    - **Compound Analysis**: High-risk alerts triggered by multi-sensor instability.
- **Sim-Server Integration**: Native support for the [Malendau Simulation Server](https://github.com/Jnanik-AI/malendau-hackathon) via SSE streams.
- **AI Explanation Layer**: Powered by Groq/Llama 3.1, translating complex sensor fluctuations into maintenance recommendations.
- **Automatic Incident Reporting**: Self-reporting alerts back to the simulation server for real-time mission feedback.

## 🛠️ System Architecture

### Backend Agent (Python)
- `main.py`: The central mission loop and alert reporter.
- `app/ingestion.py`: Asynchronous SSE aggregation and History API synchronization.
- `app/anomaly.py`: Statistical detection engine (Outliers + Trends).
- `app/baseline.py`: Dynamic calibration engine that learns "normal" operating ranges.
- `app/llm_explainer.py`: Integration with Groq for expert diagnostic advice.

### Tactical Dashboard (Frontend)
- `index.html`: Multi-view shell (Overview, Diagnostics, Maintenance Matrix).
- `styles.css`: Blueprint-inspired aesthetics with Glassmorphism and CRT effects.
- `app.js`: Live data binding to simulation SSE streams.

## 🚦 Setup & Launch

### 1. Prerequisites
- Python 3.11+
- [Groq API Key](https://console.groq.com/)
- [Node.js](https://nodejs.org/) (for the simulation server)

### 2. Launch Sequence
1.  **Start Simulation Server**:
    ```bash
    cd ../malendau-hackathon
    npm start
    ```
2.  **Start Sentinel 4 Backend**:
    ```bash
    cd sentinel4
    export GROQ_API_KEY=your_key_here
    python main.py
    ```
3.  **Deploy Dashboard**:
    Open `frontend/index.html` in your browser.

## ⚙️ Configuration & Tuning
Adjust sensitivities in `config.py`:
- `SPIKE_Z_THRESHOLD`: Default `3.2` (Sensitivity to sudden jumps).
- `DRIFT_Z_THRESHOLD`: Default `1.8` (Sensitivity to slow trends).

## 🗄️ Telemetry Database
- Sentinel 4 now persists every processed reading into a database table: `telemetry_readings`.
- Default database is local SQLite at `data/sentinel4.db` (auto-created).
- For deployment, set `DATABASE_URL` to a managed database.

Examples:

```bash
# Default (local SQLite)
export DATABASE_URL=sqlite:///data/sentinel4.db

# PostgreSQL (recommended for production)
export DATABASE_URL=postgresql+psycopg://user:password@host:5432/sentinel4
```

Stored columns include:
- `timestamp`, `machine_id`
- `temperature`, `vibration`, `rpm`, `current`
- `risk`
- `payload_json` (raw event payload for audit/debug)

History API (started automatically with `python main.py`):
- `HISTORY_API_HOST` default: `127.0.0.1`
- `HISTORY_API_PORT` default: `8010`
- Endpoint: `GET/DELETE /api/history`
- Endpoint: `DELETE /api/history/{id}`

---
**Mission Status**: Fully Integrated & Ready for Deployment.

## Phase-3 Update (2026-04-18)

- Added PDF report generation support in the main dashboard workflow.
- Added History view export options for CSV, JSON, and PDF.
- Normalized Overview visual thresholds so out-of-range values are highlighted consistently.
- Synced frontend fallback simulation refresh timing with the 1-second API stream cadence.
- Extended status normalization and telemetry persistence integration for stable API/history behavior.
