# Changelog

All notable changes to the Sentinel 4 Industrial Monitoring system will be documented in this file.

## [1.6.0] - 2026-04-17

### Added
- **Tactical Geographic Mapping**: Labeled the Risk Geo Mapping grid with facility sectors (Sec_A-F) and floor levels (Lvl_1-6).
- **Physical Asset Mapping**: Tied specific hardware units to geographic coordinates on the facility floor map.
- **Dynamic Asset Heatmap**: Implemented real-time color and pulse synchronization between the floor map and individual machine risk levels.
- **Forensic Legend System**: Added high-contrast, color-coded legends to all telemetric forensic charts for improved readability.

## [1.5.0] - 2026-04-17

### Fixed
- **LLM Explanation Parsing**: Corrected list indexing error in `app/llm_explainer.py`.
- **JSON Depth Logic**: Fixed a crash in `load_history` due to nested simulation response objects.
- **Baseline Engine API**: Added missing `train` method to support bulk historical ingestion.

## [1.3.0] - 2026-04-17


### Added
- **Tactical OS UI Upgrade**: Implemented a high-fidelity "Industrial Neon Noir" design system across the entire application.
- **Tailwind Integration**: Transitioned to a sleek, responsive Tailwind-based layout with custom HUD elements.
- **Bento-Grid Mission Control**: Rebuilt the dashboard with high-density machine telemetry cards and a spatial status layout.
- **Dynamic Risk Heatmap**: Added a real-time risk geography visualization for Facility Alpha's monitoring sectors.
- **Enhanced AI Diagnostics View**: Created a forensic deep-dive screen for AI incident analysis and logic-chain explanations.
- **Asset Service Matrix**: Integrated a detailed maintenance log and service timeline for operational management.
- **Industrial FX Layer**: Added tactile blueprint grid backgrounds and CRT scanline overlays for a premium mechanical aesthetic.

## [1.2.0] - 2026-04-17


### Added
- **Predictive Failure Detection**: Added state-aware tracking in `anomaly.py` to issue "Failure likely soon" warnings when high-risk patterns persist across 3+ readings.
- **Integrated Agent Loop**: Unified the core monitoring process in `main.py` with real-time terminal dashboard rendering using the `rich` library.
- **Refined AI Diagnostics**: Enhanced the LLM explainer prompt to provide specific physical maintenance steps and component inspection priorities.
- **Alert Persistence**: Synchronized the alert store history with LLM-generated explanations for both local and dashboard visibility.

## [1.1.0] - 2026-04-17


### Added
- **Integrated Web Dashboard**: Created a high-fidelity frontend in the `frontend/` directory.
- **Responsive Design**: Implemented mobile-first breakpoints and adaptable grid layouts.
- **Multi-View Navigation**: Seamlessly integrated "Machine Overview" and "Predictive Diagnostics" pages.
- **Glassmorphism UI**: Added modern industrial aesthetics with neon accents and refined spacing.
- **Documentation**: Added `README.md` and `CHANGELOG.md` to the project root.

### Changed
- **Information Density**: Refined frontend card layouts to reduce congestion and increase visual clarity.
- **Status Badges**: Standardized alert levels (Nominal, Warning, Critical) across backend and frontend.

## [1.0.0] - 2026-04-16

### Added
- **Core Agent Loop**: Implemented the main asynchronous monitoring loop.
- **Anomaly Detection Engine**: Added Spike, Drift, and Compound detection logic.
- **LLM Explainer**: Integrated Groq/Llama 3.1 for automated incident diagnostics.
- **Data Ingestion**: Added support for historical CSV playback and live stream placeholders.
- **Terminal UI**: Built a real-time monitor using the `rich` library.
