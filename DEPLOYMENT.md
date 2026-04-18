# Deployment Guide: Sentinel 4

This document provides a step-by-step guide to deploying the **Sentinel 4** Industrial AI Monitoring System. Since the project consists of three interconnected components (Simulation Server, Python Backend, and Frontend), we'll look at how to deploy each.

---

## 🏗️ Architecture Overview

1.  **Simulation Server (Node.js/Express)**: Generates synthetic sensor data.
2.  **Sentinel 4 Agent (Python/Asyncio)**: Processes data, detects anomalies, and manages AI diagnostics.
3.  **Frontend Dashboard (Static HTML/JS)**: Visualizes the data.

## 🚀 Option 1: Railway (Recommended for Backend)

[Railway](https://railway.app/) is arguably the simplest way to deploy persistent Python and Node.js services.

### 1. Deploy Simulation Server (Node.js)
1.  Connect your GitHub repo to Railway.
2.  Add a new **Empty Service** and point it to the `/malendau-hackathon` directory.
3.  Railway will auto-detect the Node.js environment and run `npm start`.
4.  Copy the generated **Public Domain** (e.g., `https://simulation-production.up.railway.app`).

### 2. Deploy Sentinel 4 Agent (Python)
1.  Add another service from the same repo, pointing to the **Root** directory.
2.  Railway will detect the `requirements.txt` and `main.py`.
3.  Go to the **Variables** tab and add:
    -   `SIM_SERVER_URL`: The URL of your Simulation Server (from step 1).
    -   `GROQ_API_KEY`: Your Groq API key.
    -   `TWILIO_ACCOUNT_SID`: (Optional)
    -   `EMAIL_SENDER`: (Optional)
4.  Railway handles persistent loops automatically, so your `asyncio` monitor will stay active 24/7.

---

## 🚀 Option 2: Render (Alternative)

### 1. Deploy Simulation Server (Node.js)
-   **Service Type**: Web Service.
-   **Source**: Your GitHub repository.
-   **Root Directory**: `malendau-hackathon/`
-   **Build Command**: `npm install`
-   **Start Command**: `node server.js`
-   **Environment Variables**: None required by default, but note the URL assigned by Render (e.g., `https://sentinel-sim.onrender.com`).

### 2. Deploy Sentinel 4 Agent (Python)
-   **Service Type**: Web Service (or Background Worker if you don't need the internal status API exposed).
-   **Root Directory**: `.` (Root)
-   **Build Command**: `pip install -r requirements.txt`
-   **Start Command**: `python main.py`
-   **Environment Variables**:
    -   `SIM_SERVER_URL`: The URL of your Simulation Server (from step 1).
    -   `GROQ_API_KEY`: Your Groq API key.
    -   `TWILIO_ACCOUNT_SID`: (Optional) Your Twilio SID.
    -   `TWILIO_AUTH_TOKEN`: (Optional) Your Twilio Token.
    -   `TWILIO_FROM_NUMBER`: (Optional)
    -   `TWILIO_TO_NUMBER`: (Optional)
    -   `EMAIL_SENDER` / `EMAIL_PASSWORD` / `EMAIL_RECEIVER`: (Optional)

### 3. Deploy Frontend (Static Site)
-   **Service Type**: Static Site.
-   **Root Directory**: `frontend/`
-   **Build Command**: (None, it's just static files)
-   **Publish Directory**: `.`
-   **Configuration**: You may need to edit `frontend/app.js` to point to the live Python Backend URL instead of `localhost`.

---

## 🚀 Option 2: Docker (Recommended for Portability)

If you use Docker, you can deploy to any cloud provider (Azure Container Apps, AWS ECS, DigitalOcean App Platform).

### Step 1: Create a `Dockerfile` in the root
```dockerfile
# Composite build or individual deployments
FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
CMD ["python", "main.py"]
```

### Step 2: Use Docker Compose for Local/Cloud Testing
Create a `docker-compose.yml`:
```yaml
services:
  simulation:
    build: ./malendau-hackathon
    ports:
      - "3000:3000"
  agent:
    build: .
    environment:
      - SIM_SERVER_URL=http://simulation:3000
    depends_on:
      - simulation
```

---

## 🚀 Option 3: Vercel (Frontend + Serverless Functions)

Vercel is best for the **Frontend**, but the Python backend uses a persistent `asyncio` loop which isn't suitable for Serverless Functions.

1.  **Deploy Frontend**: Connect your repo to Vercel and set the Root Directory to `frontend/`.
2.  **Deploy Backend Elsewhere**: Use Render or a VPS (DigitalOcean/Azure VM) for the Python Agent, as it needs to run continuously to monitor the stream.

---

## 📝 Critical Deployment Notes

1.  **SSE Connection**: The frontend uses `EventSource`. Ensure your deployment platform supports long-lived HTTP connections (most do, but some serverless platforms have short timeouts).
2.  **Environment Variables**: Never hardcode keys. Always use the platform's Secret Management or a `.env` file (excluded from Git).
3.  **Port Configuration**: Ensure the `SIM_SERVER_URL` in your `.env` matches the actual assigned URL of the simulation server in production.

---
**Status**: Ready for production deployment. Optimized for Hack Malnadu 2026.