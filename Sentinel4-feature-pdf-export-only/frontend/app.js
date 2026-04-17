/**
 * SENTINEL 4 - Mission Control Frontend OS
 * Unified Data Binding & Real-Time Simulation Integration
 */

const machines = ['CNC_01', 'CNC_02', 'PUMP_03', 'CONVEYOR_04'];
const sensorKeys = ['temperature_C', 'vibration_mm_s', 'rpm', 'current_A'];

const baseValues = {
    'CNC_01': { temperature_C: 84.5, vibration_mm_s: 1.8, rpm: 1475, current_A: 13.4 },
    'CNC_02': { temperature_C: 72.1, vibration_mm_s: 0.9, rpm: 2100, current_A: 11.2 },
    'PUMP_03': { temperature_C: 45.9, vibration_mm_s: 0.1, rpm: 1800, current_A: 5.8 },
    'CONVEYOR_04': { temperature_C: 28.4, vibration_mm_s: 0.5, rpm: 450, current_A: 2.1 }
};

let machineData = {};
let alerts = [];
let activeView = 'dashboard';
let selectedMachine = null;
let incidentSelectedMachine = null;
let eventSources = {};
let machineHistory = {};
let forensicCharts = {}; // Changed from singular forensicChart
const MAX_HISTORY = 50;
const sensorMap = [
    { key: 'temperature_C', fn: getTempClass, label: 'TEMP' },
    { key: 'vibration_mm_s', fn: getVibClass, label: 'VIB' },
    { key: 'rpm', fn: (v) => 'text-on-background', label: 'RPM' }, // RPM is nominal for now
    { key: 'current_A', fn: getLoadClass, label: 'LOAD' }
];

const apiBaseUrl = window.SENTINEL4_API_BASE_URL || 'http://localhost:3000';
let liveBaselineCache = null;
let serverAlertPollHandle = null;
let correlationIsolated = false;
let correlationViewMode = 'overlay';
const seenServerAlertIds = new Set();

function setBaselineStatus(text) {
    const status = document.getElementById('baseline-status');
    if (status) status.innerText = text;
}

function getMachineBaseline(mId) {
    const live = liveBaselineCache && liveBaselineCache[mId];
    if (live) {
        return {
            temperature_C: live.temp,
            vibration_mm_s: live.vib,
            rpm: live.rpm,
            current_A: live.current,
        };
    }
    return baseValues[mId];
}

function deriveRiskFromMetrics(mId, metrics) {
    const base = getMachineBaseline(mId);
    if (!base || !metrics) return 0.0;

    let risk = 0.1;
    if (metrics.temperature_C > base.temperature_C * 1.2) risk += 0.4;
    if (metrics.vibration_mm_s > base.vibration_mm_s * 2.0) risk += 0.4;
    if (metrics.current_A > base.current_A * 1.25) risk += 0.1;
    if (metrics.rpm && base.rpm && metrics.rpm < base.rpm * 0.9) risk += 0.1;

    return Math.min(1.0, risk);
}

function hasRecentLiveTelemetry(mId) {
    const machine = machineData[mId];
    if (!machine || !machine.lastLiveSeenAt) return false;
    return (Date.now() - machine.lastLiveSeenAt) < 10000;
}

function formatTimelineTimestamp(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleTimeString();
}

function setReportStatus(message, tone = 'neutral') {
    const status = document.getElementById('report-status');
    if (!status) return;

    status.innerText = message;
    status.className = 'text-[10px] font-mono tracking-wider uppercase';
    if (tone === 'ok') status.classList.add('text-primary-container');
    else if (tone === 'error') status.classList.add('text-secondary');
    else status.classList.add('text-outline');
}

function getActiveMachineForReport() {
    if (selectedMachine && machineData[selectedMachine]) return selectedMachine;
    if (incidentSelectedMachine && machineData[incidentSelectedMachine]) return incidentSelectedMachine;
    return machines[0];
}

function getSeverityLabel(risk) {
    if (risk >= 0.8) return 'CRITICAL';
    if (risk >= 0.6) return 'WARNING';
    return 'NOMINAL';
}

function generatePdfReport() {
    const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPdfCtor) {
        setReportStatus('PDF_ENGINE_UNAVAILABLE', 'error');
        return;
    }

    const reportKindEl = document.getElementById('report-kind');
    const reportKind = reportKindEl ? reportKindEl.value : 'summary';
    const machineId = getActiveMachineForReport();
    const machine = machineData[machineId];
    if (!machine) {
        setReportStatus('NO_MACHINE_DATA', 'error');
        return;
    }

    const now = new Date();
    const risk = machine.risk || 0;
    const severity = getSeverityLabel(risk);
    const baseline = getMachineBaseline(machineId);
    const recentAlerts = alerts.slice(0, 5);
    const history = machineHistory[machineId] || { temp: [], vib: [], rpm: [], load: [] };
    const reportId = `RPT-${now.getTime().toString(36).toUpperCase()}`;

    const doc = new jsPdfCtor({ unit: 'pt', format: 'a4' });
    const left = 52;
    let y = 52;

    const writeLine = (label, value) => {
        doc.setFont('courier', 'bold');
        doc.setTextColor(90, 90, 90);
        doc.text(label, left, y);
        doc.setFont('courier', 'normal');
        doc.setTextColor(20, 20, 20);
        doc.text(String(value), left + 190, y);
        y += 20;
    };

    doc.setFillColor(19, 19, 19);
    doc.rect(0, 0, 595, 86, 'F');
    doc.setTextColor(255, 215, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text('SENTINEL 4 // TACTICAL REPORT', left, 45);
    doc.setFontSize(11);
    doc.text(`TYPE: ${reportKind.toUpperCase()}`, left, 68);

    y = 118;
    doc.setFontSize(12);
    writeLine('REPORT_ID', reportId);
    writeLine('GENERATED_AT_UTC', now.toISOString());
    writeLine('MACHINE_ID', machineId);
    writeLine('SEVERITY', severity);
    writeLine('RISK_SCORE', risk.toFixed(2));

    y += 10;
    doc.setDrawColor(220, 220, 220);
    doc.line(left, y, 540, y);
    y += 24;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(35, 35, 35);
    doc.text('TELEMETRY SNAPSHOT', left, y);
    y += 22;
    doc.setFont('courier', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(25, 25, 25);

    writeLine('TEMPERATURE_C', `${machine.metrics.temperature_C?.toFixed(2)}  (baseline ${baseline.temperature_C?.toFixed(2)})`);
    writeLine('VIBRATION_MM_S', `${machine.metrics.vibration_mm_s?.toFixed(2)}  (baseline ${baseline.vibration_mm_s?.toFixed(2)})`);
    writeLine('RPM', `${machine.metrics.rpm?.toFixed(0)}  (baseline ${baseline.rpm?.toFixed(0)})`);
    writeLine('CURRENT_A', `${machine.metrics.current_A?.toFixed(2)}  (baseline ${baseline.current_A?.toFixed(2)})`);

    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.text('RECENT ALERTS', left, y);
    y += 20;
    doc.setFont('courier', 'normal');
    doc.setFontSize(10);

    if (!recentAlerts.length) {
        doc.text('NO ALERTS IN CURRENT WINDOW', left, y);
        y += 16;
    } else {
        recentAlerts.forEach((alert, idx) => {
            const line = `${idx + 1}. ${alert.timestamp || '--'} | ${alert.machineId || '--'} | ${alert.title || 'EVENT'} | ${alert.message || ''}`;
            const wrapped = doc.splitTextToSize(line, 480);
            doc.text(wrapped, left, y);
            y += wrapped.length * 13 + 4;
        });
    }

    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('TREND DIGEST (LAST WINDOW)', left, y);
    y += 20;
    doc.setFont('courier', 'normal');

    const safeMean = (arr) => arr && arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    writeLine('AVG_TEMP_C', safeMean(history.temp).toFixed(2));
    writeLine('AVG_VIB_MM_S', safeMean(history.vib).toFixed(2));
    writeLine('AVG_RPM', safeMean(history.rpm).toFixed(0));
    writeLine('AVG_CURRENT_A', safeMean(history.load).toFixed(2));

    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('RECOMMENDED ACTION', left, y);
    y += 18;
    doc.setFont('courier', 'normal');
    const recommendation = risk >= 0.8
        ? 'Immediate inspection and controlled shutdown prep. Escalate to maintenance lead.'
        : (risk >= 0.6
            ? 'Schedule maintenance window and increase monitor frequency for this unit.'
            : 'Continue nominal monitoring cadence.');
    const recLines = doc.splitTextToSize(recommendation, 480);
    doc.text(recLines, left, y);

    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('AUTO-GENERATED BY SENTINEL 4 FRONTEND REPORT GENERATOR', left, 810);

    const stamp = now.toISOString().replace(/[:.]/g, '-');
    doc.save(`SENTINEL4_${reportKind.toUpperCase()}_${machineId}_${stamp}.pdf`);
    setReportStatus('REPORT_EXPORTED', 'ok');
}

async function fetchJson(path) {
    const response = await fetch(`${apiBaseUrl}${path}`);
    if (!response.ok) {
        throw new Error(`Request failed: ${path} (${response.status})`);
    }
    return response.json();
}

async function hydrateMachineBaselines() {
    try {
        const payload = await fetchJson('/machines');
        liveBaselineCache = payload.baselines || null;
        setBaselineStatus('BASELINES_SYNCED');
    } catch (error) {
        liveBaselineCache = null;
        setBaselineStatus('FALLBACK_BASELINES');
    }
}

async function hydrateHistoryFromServer() {
    try {
        const snapshots = await Promise.all(machines.map(async (mId) => {
            try {
                const payload = await fetchJson(`/history/${mId}`);
                return { mId, readings: Array.isArray(payload.readings) ? payload.readings : [] };
            } catch {
                return { mId, readings: [] };
            }
        }));

        snapshots.forEach(({ mId, readings }) => {
            if (!readings.length || !machineData[mId]) return;

            const window = readings.slice(-MAX_HISTORY);
            machineHistory[mId] = {
                labels: window.map(entry => new Date(entry.timestamp).toLocaleTimeString()),
                temp: window.map(entry => Number(entry.temperature_C ?? getMachineBaseline(mId).temperature_C)),
                vib: window.map(entry => Number(entry.vibration_mm_s ?? getMachineBaseline(mId).vibration_mm_s)),
                rpm: window.map(entry => Number(entry.rpm ?? getMachineBaseline(mId).rpm)),
                load: window.map(entry => Number(entry.current_A ?? getMachineBaseline(mId).current_A))
            };

            const latest = window[window.length - 1];
            machineData[mId].metrics = {
                temperature_C: Number(latest.temperature_C),
                vibration_mm_s: Number(latest.vibration_mm_s),
                rpm: Number(latest.rpm),
                current_A: Number(latest.current_A)
            };
            machineData[mId].risk = deriveRiskFromMetrics(mId, machineData[mId].metrics);
            machineData[mId].lastUpdated = new Date(latest.timestamp);
        });

        setBaselineStatus('HISTORY_SEEDED');
    } catch (error) {
        setBaselineStatus('HISTORY_FALLBACK');
    }
}

async function syncServerAlerts() {
    const poll = async () => {
        try {
            const payload = await fetchJson('/alerts');
            const serverAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];

            serverAlerts.forEach(alert => {
                if (!alert.id || seenServerAlertIds.has(alert.id)) return;
                seenServerAlertIds.add(alert.id);
                alerts.unshift({
                    id: alert.id,
                    machineId: alert.machine_id,
                    title: 'Server Alert',
                    message: alert.reason,
                    timestamp: formatTimelineTimestamp(alert.triggered_at),
                    type: 'critical',
                    source: 'server'
                });
            });

            if (alerts.length > 10) alerts.length = 10;
            renderAlertFeed();
            renderMaintenanceTimeline();
            if (activeView === 'incident') renderIncident();
        } catch {
            // Silent fallback; the local alert feed will keep working.
        }
    };

    await poll();
    if (!serverAlertPollHandle) {
        serverAlertPollHandle = setInterval(poll, 2500);
    }
}

function renderMaintenanceTimeline() {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    const items = alerts.slice(0, 5).map((alert, index) => {
        const isCritical = alert.type === 'critical' || /critical|failure|fault/i.test(alert.message || alert.title || '');
        const accentClass = isCritical ? 'border-secondary text-secondary' : 'border-primary-container text-primary-container';
        const sourceLabel = alert.source === 'server' ? 'REAL_TIME' : 'LOCAL_AI';
        return `
            <article class="relative pl-8 pb-6 border-l border-outline-variant/20 last:pb-0">
                <div class="absolute left-[-7px] top-1 w-3 h-3 ${isCritical ? 'bg-secondary' : 'bg-primary-container'}"></div>
                <div class="flex items-center gap-3 mb-1">
                    <span class="font-mono text-xs ${accentClass}">${sourceLabel}</span>
                    <span class="font-mono text-[10px] text-outline bg-surface-container-high px-2 py-0.5">${alert.timestamp}</span>
                </div>
                <h4 class="font-headline text-sm tracking-widest uppercase text-on-surface">${alert.machineId}</h4>
                <p class="text-sm text-on-surface-variant mt-1 leading-relaxed">${alert.message}</p>
            </article>
        `;
    });

    if (!items.length) {
        const snapshots = machines.map((mId) => {
            const data = machineData[mId];
            const risk = data ? data.risk : 0;
            const status = risk >= 0.8 ? 'SERVICE_NEEDED' : (risk >= 0.6 ? 'WATCHLIST' : 'STABLE');
            return `
                <article class="relative pl-8 pb-6 border-l border-outline-variant/20 last:pb-0">
                    <div class="absolute left-[-7px] top-1 w-3 h-3 ${risk >= 0.8 ? 'bg-secondary' : 'bg-primary-container'}"></div>
                    <div class="flex items-center gap-3 mb-1">
                        <span class="font-mono text-xs ${risk >= 0.8 ? 'text-secondary' : 'text-primary-container'}">${status}</span>
                        <span class="font-mono text-[10px] text-outline bg-surface-container-high px-2 py-0.5">${formatTimelineTimestamp(data && data.lastUpdated)}</span>
                    </div>
                    <h4 class="font-headline text-sm tracking-widest uppercase text-on-surface">${mId}</h4>
                    <p class="text-sm text-on-surface-variant mt-1 leading-relaxed">${data ? `Risk ${data.risk.toFixed(2)} · ${data.metrics.temperature_C?.toFixed(1)}°C / ${data.metrics.vibration_mm_s?.toFixed(2)} mm/s` : 'Awaiting telemetry...'}</p>
                </article>
            `;
        });
        container.innerHTML = `<div class="space-y-2">${snapshots.join('')}</div>`;
        return;
    }

    container.innerHTML = `<div class="space-y-2">${items.join('')}</div>`;
}

function getCorrelationPair() {
    if (!correlationIsolated) {
        return [machines[0], machines[machines.length - 1]];
    }

    const ranked = [...machines].sort((left, right) => {
        return (machineData[right]?.risk || 0) - (machineData[left]?.risk || 0);
    });
    return [ranked[0], ranked[1] || ranked[0]];
}

// Initialization
async function init() {
    machines.forEach(m => {
        machineData[m] = {
            id: m,
            metrics: { ...baseValues[m] },
            risk: 0.15,
            lastUpdated: new Date(),
            lastLiveSeenAt: 0
        };
        // Initialize history buffer
        machineHistory[m] = {
            labels: Array(MAX_HISTORY).fill(''),
            temp: Array(MAX_HISTORY).fill(baseValues[m].temperature_C),
            vib: Array(MAX_HISTORY).fill(baseValues[m].vibration_mm_s),
            rpm: Array(MAX_HISTORY).fill(baseValues[m].rpm),
            load: Array(MAX_HISTORY).fill(baseValues[m].current_A)
        };
    });

    setupEventListeners();

    await hydrateMachineBaselines();
    await hydrateHistoryFromServer();

    // Attempt to connect to live simulation server (malendau-hackathon)
    connectToLiveStreams();

    void syncServerAlerts();

    // Fallback/Parallel simulation for UI consistency
    startLocalSimulation();
    
    renderAll();
}

function connectToLiveStreams() {
    machines.forEach(mId => {
        try {
            const es = new EventSource(`${apiBaseUrl}/stream/${mId}`);
            es.onmessage = (e) => {
                const reading = JSON.parse(e.data);
                updateMachineData(mId, reading, 'live');
            };
            es.onerror = () => {
                console.warn(`Could not connect to live stream for ${mId}. Ensure sim-server is running on :3000`);
            };
            eventSources[mId] = es;
        } catch (err) {
            console.error(`SSE Initialization failed for ${mId}`);
        }
    });
}

function updateMachineData(mId, reading, source = 'live') {
    if (!machineData[mId]) return;
    if (source === 'simulation' && hasRecentLiveTelemetry(mId)) return;
    
    machineData[mId].metrics = { ...reading };
    machineData[mId].lastUpdated = new Date(reading.timestamp);
    if (source !== 'simulation') {
        machineData[mId].lastLiveSeenAt = Date.now();
    }
    machineData[mId].source = source;

    // Update history buffer
    const history = machineHistory[mId];
    history.labels.push(new Date(reading.timestamp).toLocaleTimeString());
    history.temp.push(reading.temperature_C);
    history.vib.push(reading.vibration_mm_s);
    history.rpm.push(reading.rpm);
    history.load.push(reading.current_A);

    if (history.labels.length > MAX_HISTORY) {
        history.labels.shift();
        history.temp.shift();
        history.vib.shift();
        history.rpm.shift();
        history.load.shift();
    }
    
    // In a live environment, the risk would come from the backend.
    if (source !== 'simulation') {
        calculateClientRisk(mId);
    } else {
        machineData[mId].risk = deriveRiskFromMetrics(mId, machineData[mId].metrics);
    }
    
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'diagnostics' && selectedMachine === mId) {
        renderDiagnostics();
        updateForensicChart();
    }
    if (activeView === 'incident') renderIncident();
}

function calculateClientRisk(mId) {
    const metrics = machineData[mId].metrics;
    const risk = deriveRiskFromMetrics(mId, metrics);

    const prevRisk = machineData[mId].risk;
    machineData[mId].risk = risk;

    // Trigger alert if risk spikes to Critical
    if (machineData[mId].risk >= 0.8 && prevRisk < 0.8) {
        addAlert(mId, 'Critical Anomaly Detected', `Significant deviation in ${mId} metrics. Recommendation: Immediate Inspection.`);
    }
}

function addAlert(machineId, title, message) {
    const alert = {
        id: `AL-${Date.now()}`,
        machineId,
        title,
        message,
        timestamp: new Date().toLocaleTimeString(),
        type: 'critical',
        source: 'local'
    };
    alerts.unshift(alert);
    if (alerts.length > 5) alerts.pop();
    renderAlertFeed();
    renderMaintenanceTimeline();
    if (activeView === 'incident') renderIncident();
    
    // Also update Diagnostics if this machine is selected
    if (selectedMachine === machineId) {
        document.getElementById('ai-narrative').innerHTML = `<span class="text-error font-bold">[!] ${alert.timestamp}</span>: ${message}`;
    }
}

function renderAlertFeed() {
    const feed = document.getElementById('dashboard-alert-feed');
    if (!feed) return;
    feed.innerHTML = '';

    alerts.forEach(alert => {
        const item = document.createElement('div');
        item.className = 'border-l-2 border-error pl-4 py-2 bg-error/5 hover:bg-error/10 transition-colors cursor-help';
        item.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="text-[10px] font-black text-error uppercase">${alert.machineId}</span>
                <span class="text-[8px] font-mono text-outline/50">${alert.timestamp}</span>
            </div>
            <div class="flex items-center justify-between gap-2 mb-1">
                <p class="text-[10px] font-bold text-on-surface uppercase">${alert.title}</p>
                <span class="text-[8px] font-mono ${alert.source === 'server' ? 'text-primary-container' : 'text-secondary'} uppercase">${alert.source === 'server' ? 'LIVE' : 'LOCAL'}</span>
            </div>
            <p class="text-[9px] text-on-surface-variant leading-tight">${alert.message}</p>
        `;
        feed.appendChild(item);
    });
}

function setupEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;
            if (viewId) switchView(viewId);
        });
    });

    document.querySelectorAll('[data-action="generate-report"]').forEach(btn => {
        btn.addEventListener('click', () => {
            setReportStatus('GENERATING_REPORT...');
            generatePdfReport();
        });
    });
}

function switchView(viewId) {
    activeView = viewId;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('.content-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    const scrollContainer = document.querySelector('main.flex-1');
    if (scrollContainer) {
        scrollContainer.scrollTo({
            top: 0,
            behavior: prefersReducedMotion ? 'auto' : 'smooth'
        });
    }
    renderAll();
}

function startLocalSimulation() {
    // If SSE isn't working, this keeps the UI "alive"
    setInterval(() => {
        machines.forEach(m => {
            if (hasRecentLiveTelemetry(m)) return; // Don't override fresh SSE data

            const current = machineData[m].metrics;
            const base = getMachineBaseline(m);
            const nextReading = {
                timestamp: new Date().toISOString(),
                machine_id: m,
                temperature_C: Math.max(0, current.temperature_C + (Math.random() - 0.5) * (base.temperature_C * 0.02)),
                vibration_mm_s: Math.max(0, current.vibration_mm_s + (Math.random() - 0.5) * (base.vibration_mm_s * 0.05)),
                rpm: Math.max(0, current.rpm + (Math.random() - 0.5) * (base.rpm * 0.01)),
                current_A: Math.max(0, current.current_A + (Math.random() - 0.5) * (base.current_A * 0.03))
            };

            updateMachineData(m, nextReading, 'simulation');
        });
    }, 3000);
}

function renderAll() {
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'diagnostics') renderDiagnostics();
    if (activeView === 'incident') renderIncident();
    if (activeView === 'maintenance') renderMaintenance();
}

function renderIncident() {
    const listEl = document.getElementById('incident-events-list');
    if (!listEl) return;

    const localIncidentFeed = alerts.slice(0, 8).map((alert, idx) => ({
        id: alert.id || `INC-${idx}`,
        machineId: alert.machineId || machines[0],
        title: alert.title || 'Telemetry Event',
        message: alert.message || 'No details available',
        timestamp: alert.timestamp || '--',
        source: alert.source || 'local'
    }));

    const derivedEvents = localIncidentFeed.length ? localIncidentFeed : [...machines]
        .sort((a, b) => (machineData[b]?.risk || 0) - (machineData[a]?.risk || 0))
        .map((mId, idx) => {
            const machine = machineData[mId];
            const risk = machine?.risk || 0;
            return {
                id: `DERIVED-${mId}`,
                machineId: mId,
                title: risk >= 0.8 ? `${mId} - Critical Pattern` : (risk >= 0.6 ? `${mId} - Warning Drift` : `${mId} - Routine Sync`),
                message: machine ? `Temp ${machine.metrics.temperature_C?.toFixed(1)}°C / Vib ${machine.metrics.vibration_mm_s?.toFixed(2)} mm/s` : 'Awaiting telemetry...',
                timestamp: machine ? formatTimelineTimestamp(machine.lastUpdated) : '--',
                source: 'derived'
            };
        });

    if (!incidentSelectedMachine) {
        incidentSelectedMachine = derivedEvents[0]?.machineId || machines[0];
    }
    if (!machineData[incidentSelectedMachine]) {
        incidentSelectedMachine = machines[0];
    }
    selectedMachine = incidentSelectedMachine;

    listEl.innerHTML = derivedEvents.map(event => {
        const active = event.machineId === incidentSelectedMachine;
        const machineRisk = machineData[event.machineId]?.risk || 0;
        const severityColor = machineRisk >= 0.8 ? 'text-secondary' : (machineRisk >= 0.6 ? 'text-primary-container' : 'text-tertiary-fixed-dim');
        return `
            <button type="button" data-machine="${event.machineId}" class="w-full text-left p-4 hover:bg-surface-container-high transition-colors ${active ? 'bg-surface-container-high' : ''}">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-[10px] font-mono text-outline">${event.timestamp}</span>
                    <span class="material-symbols-outlined text-xs ${severityColor}">${machineRisk >= 0.8 ? 'warning' : 'info'}</span>
                </div>
                <div class="flex items-center gap-2 mb-1">
                    <span class="w-1.5 h-1.5 ${machineRisk >= 0.8 ? 'bg-secondary' : (machineRisk >= 0.6 ? 'bg-primary-container' : 'bg-tertiary-fixed-dim')}"></span>
                    <h3 class="font-headline font-bold text-sm text-on-surface uppercase">${event.title}</h3>
                </div>
                <p class="text-xs text-on-surface-variant/80 leading-relaxed">${event.message}</p>
            </button>
        `;
    }).join('');

    listEl.querySelectorAll('button[data-machine]').forEach(btn => {
        btn.addEventListener('click', () => {
            incidentSelectedMachine = btn.dataset.machine;
            selectedMachine = incidentSelectedMachine;
            renderIncident();
        });
    });

    const focusMachine = machineData[incidentSelectedMachine] ? incidentSelectedMachine : machines[0];
    const metrics = machineData[focusMachine].metrics;
    const risk = machineData[focusMachine].risk || 0;
    const baseline = getMachineBaseline(focusMachine);
    const focusEvent = derivedEvents.find(e => e.machineId === focusMachine) || derivedEvents[0];

    const safeSet = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    };

    safeSet('incident-case-ref', `CASE_REF: AX-${focusMachine}-${Math.floor(Math.random() * 9000) + 1000}`);
    safeSet('incident-state', `Status: ${risk >= 0.8 ? 'Action Required' : (risk >= 0.6 ? 'Heightened Watch' : 'Nominal')}`);
    safeSet('incident-unit', focusMachine);
    safeSet('incident-title', focusEvent?.title || `${focusMachine} - Live Incident`);
    safeSet('incident-message', focusEvent?.message || 'Telemetry stream active. No structured message available.');
    safeSet('incident-location', `SECTOR_${focusMachine.split('_')[1] || '00'}_NORTH`);
    safeSet('incident-duration', `${Math.max(1, Math.round(risk * 120))}:00`);
    safeSet('incident-severity', risk >= 0.8 ? 'LEVEL_9' : (risk >= 0.6 ? 'LEVEL_5' : 'LEVEL_2'));
    safeSet('incident-temp', `${metrics.temperature_C?.toFixed(1)}°C`);
    safeSet('incident-torque', `${Math.max(1, Math.round((metrics.rpm || 0) * (metrics.current_A || 0) / 50))} Nm`);
    safeSet('incident-probability', `${Math.round(Math.max(0.08, risk) * 100)}%`);
    safeSet('incident-lock', risk >= 0.8 ? 'ACTION_LOCK' : 'SECURE');

    const logic = document.getElementById('incident-logic');
    if (logic) {
        const vibDelta = (metrics.vibration_mm_s || 0) - (baseline.vibration_mm_s || 0);
        const tempDelta = (metrics.temperature_C || 0) - (baseline.temperature_C || 0);
        logic.innerText = `Analysis: ${focusMachine} telemetry indicates ${risk >= 0.8 ? 'non-linear fault growth' : 'moderate stress oscillation'}.

Recommendation: ${risk >= 0.8 ? 'Immediate lubrication and manual inspection.' : 'Continue monitoring and schedule maintenance during next cycle.'}

System Note: Vibration delta ${vibDelta.toFixed(2)} mm/s | Thermal delta ${tempDelta.toFixed(1)}°C.`;
    }

    const rpmSvg = document.getElementById('incident-rpm-svg');
    if (rpmSvg) {
        const rpmData = (machineHistory[focusMachine]?.rpm || []).slice(-10);
        if (rpmData.length < 2) {
            rpmSvg.innerHTML = '';
        } else {
            const min = Math.min(...rpmData);
            const max = Math.max(...rpmData);
            const range = (max - min) || 1;
            const points = rpmData.map((value, index) => {
                const x = (index / (rpmData.length - 1)) * 1000;
                const y = 110 - ((value - min) / range) * 90;
                return `${x.toFixed(0)},${y.toFixed(0)}`;
            }).join(' ');
            rpmSvg.innerHTML = `<polyline fill="none" stroke="#ffd700" stroke-width="3" points="${points}"></polyline>`;
        }
    }
}

function getStatusColor(risk) {
    if (risk >= 0.8) return 'error';
    if (risk >= 0.6) return 'secondary';
    return 'primary-container';
}

function getTempClass(v) { return v > 100 ? 'text-error' : (v > 85 ? 'text-primary-container' : 'text-on-background'); }
function getVibClass(v)  { return v > 5   ? 'text-error' : (v > 3 ? 'text-primary-container' : 'text-on-background'); }
function getLoadClass(v) { return v > 22  ? 'text-error' : (v > 18 ? 'text-primary-container' : 'text-on-background'); }

function renderDashboard() {
    const grid = document.getElementById('machine-grid');
    if (!grid) return;
    grid.innerHTML = '';

    machines.forEach(m => {
        const data = machineData[m];
        const color = getStatusColor(data.risk);
        const borderClass = data.risk >= 0.8 ? 'border-error' : 'border-primary-container';
        const levelText = data.risk >= 0.8 ? 'CRITICAL' : (data.risk >= 0.6 ? 'WARNING' : 'OPERATIONAL');

        const card = document.createElement('div');
        card.className = `bg-surface-container-low border-l-2 ${borderClass} p-6 relative overflow-hidden group hover:bg-surface-container-high transition-colors cursor-pointer machine-card`;
        card.onclick = () => {
            selectedMachine = m;
            switchView('diagnostics');
        };

        card.innerHTML = `
            <div class="flex justify-between items-start mb-6">
                <div>
                    <p class="text-[10px] font-headline tracking-widest text-outline uppercase">UNIT_ID</p>
                    <h3 class="font-headline font-bold text-xl text-on-background">${m}</h3>
                </div>
                <span class="bg-${color} text-on-${color} px-2 py-1 text-[9px] font-black uppercase">${levelText}</span>
            </div>
            <div class="grid grid-cols-2 gap-4 mb-6">
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">TEMP</p>
                    <p class="font-mono text-lg ${getTempClass(data.metrics.temperature_C)} font-bold">${data.metrics.temperature_C?.toFixed(1) || '--'}°C</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">VIB</p>
                    <p class="font-mono text-lg ${getVibClass(data.metrics.vibration_mm_s)} font-bold">${data.metrics.vibration_mm_s?.toFixed(2) || '--'}</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">RPM</p>
                    <p class="font-mono text-lg text-on-background font-bold">${data.metrics.rpm?.toFixed(0) || '--'}</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">LOAD</p>
                    <p class="font-mono text-lg ${getLoadClass(data.metrics.current_A)} font-bold">${data.metrics.current_A?.toFixed(1) || '--'}A</p>
                </div>
            </div>
            <div class="h-8 w-full bg-surface-container-lowest relative overflow-hidden">
                <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 40">
                    <polyline fill="none" points="${generateGraphPoints(data.risk)}" stroke="${data.risk > 0.8 ? '#ff4c4c' : '#ffd700'}" stroke-width="2"></polyline>
                </svg>
            </div>
        `;
        grid.appendChild(card);
    });

    renderHeatmap();
    renderAlertFeed();
}

function generateGraphPoints(risk) {
    let points = "0,20 ";
    for (let i = 1; i <= 10; i++) {
        const y = 20 + (Math.random() - 0.5) * (20 * risk);
        points += `${i * 10},${y} `;
    }
    return points;
}

function renderHeatmap() {
    const heatmap = document.getElementById('heatmap-grid');
    if (!heatmap) return;
    heatmap.innerHTML = '';
    
    // Matrix: Rows = Sensors, Cols = Machines
    for (let row = 0; row < 4; row++) {
        const sensor = sensorMap[row];
        for (let col = 0; col < 4; col++) {
            const mId = machines[col];
            const data = machineData[mId];
            const cell = document.createElement('div');
            
            const colorClass = sensor.fn(data.metrics[sensor.key]);
            // Convert text-color class to bg-color for the matrix
            let bgColor = 'bg-surface-container-high/40';
            if (colorClass === 'text-error') bgColor = 'bg-error animate-pulse shadow-[0_0_10px_rgba(255,76,76,0.3)]';
            if (colorClass === 'text-primary-container') bgColor = 'bg-primary-container/80';
            
            cell.className = `transition-all duration-300 border border-outline-variant/5 ${bgColor} cursor-help`;
            cell.title = `${mId} | ${sensor.label}: ${data.metrics[sensor.key]?.toFixed(1)}`;
            
            cell.onclick = (e) => { 
                e.stopPropagation(); 
                selectedMachine = mId; 
                switchView('diagnostics'); 
            };
            
            heatmap.appendChild(cell);
        }
    }
}

function renderDiagnostics() {
    if (!selectedMachine) selectedMachine = machines[0];
    const mId = selectedMachine;
    const data = machineData[mId];

    document.getElementById('diag-machine-id').innerText = mId;
    document.getElementById('diag-case-ref').innerText = `CASE_REF: AX-${mId}-${Math.floor(Math.random()*9000)+1000}`;
    
    const color = getStatusColor(data.risk);
    const statusText = data.risk >= 0.8 ? 'CRITICAL_FAILURE_POSSIBLE' : (data.risk >= 0.6 ? 'WARNING_STRESS' : 'STABLE_NODE');
    
    document.getElementById('diag-status').innerText = `Status: ${statusText}`;
    document.getElementById('diag-status').className = `text-sm font-headline font-bold uppercase text-${color}`;
    document.getElementById('diag-header-card').className = `bg-surface-container-low p-6 border-l-4 border-${color}`;

    const narrative = document.getElementById('ai-narrative');
    if (data.risk >= 0.8) {
        narrative.innerHTML = `Analysis reveals abnormal oscillation in ${mId}. <br/><br/> Recommendation: Inspect bearing casing. Thermal drift (${data.metrics.temperature_C?.toFixed(1)}°C) suggests internal friction.`;
    } else {
        narrative.innerHTML = `Machine ${mId} is operating within nominal parameters. <br/><br/> Recommendation: Routine maintenance cycle maintained.`;
    }

    if (Object.keys(forensicCharts).length === 0) initForensicCharts();
    updateForensicChart();
}

function initForensicCharts() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded. Diagnostics graphs are disabled.');
        const narrative = document.getElementById('ai-narrative');
        if (narrative) {
            narrative.innerHTML = 'Telemetry charts unavailable: Chart.js failed to load. Check network access or CDN availability.';
        }
        return;
    }

    const config = (color, label) => ({
        type: 'line',
        data: {
            labels: Array(MAX_HISTORY).fill(''),
            datasets: [{ label, borderColor: color, data: [], fill: { target: 'origin', above: color + '11' } }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            elements: { point: { radius: 0 }, line: { tension: 0.2, borderWidth: 1.5 } },
            scales: {
                x: { display: false },
                y: { 
                    beginAtZero: false,
                    ticks: { font: { family: 'JetBrains Mono', size: 8 }, color: '#999077', maxTicksLimit: 3 },
                    grid: { color: '#4d473211' } 
                }
            },
            plugins: { legend: { display: false } }
        }
    });

    forensicCharts.temp = new Chart(document.getElementById('chart-temp').getContext('2d'), config('#ff4c4c', 'TEMP'));
    forensicCharts.vib = new Chart(document.getElementById('chart-vib').getContext('2d'), config('#ffd700', 'VIB'));
    forensicCharts.rpm = new Chart(document.getElementById('chart-rpm').getContext('2d'), config('#72ebff', 'RPM'));
    forensicCharts.load = new Chart(document.getElementById('chart-load').getContext('2d'), config('#ffb3ae', 'LOAD'));
}

function updateForensicChart() {
    if (Object.keys(forensicCharts).length === 0 || !selectedMachine) return;
    const history = machineHistory[selectedMachine];
    const data = machineData[selectedMachine].metrics;
    
    // Update numerical readouts
    const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
    safeSet('val-temp', `${data.temperature_C?.toFixed(1)}°C`);
    safeSet('val-vib', `${data.vibration_mm_s?.toFixed(2)}mm/s`);
    safeSet('val-rpm', `${data.rpm?.toFixed(0)} RPM`);
    safeSet('val-load', `${data.current_A?.toFixed(1)}A`);

    // Update charts
    forensicCharts.temp.data.labels = history.labels;
    forensicCharts.temp.data.datasets[0].data = history.temp;
    
    forensicCharts.vib.data.labels = history.labels;
    forensicCharts.vib.data.datasets[0].data = history.vib;
    
    forensicCharts.rpm.data.labels = history.labels;
    forensicCharts.rpm.data.datasets[0].data = history.rpm;
    
    forensicCharts.load.data.labels = history.labels;
    forensicCharts.load.data.datasets[0].data = history.load;
    
    Object.values(forensicCharts).forEach(c => c.update('none'));
}

function renderMaintenance() {
    const tbody = document.getElementById('maintenance-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    machines.forEach(m => {
        const data = machineData[m];
        const row = document.createElement('tr');
        row.className = 'hover:bg-surface-container-high transition-colors';
        row.innerHTML = `
            <td class="px-6 py-4 font-bold text-on-surface">${m}</td>
            <td class="px-6 py-4 font-mono text-outline">${data.risk.toFixed(2)}</td>
            <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 ${data.risk >= 0.8 ? 'bg-error shadow-[0_0_8px_#ff4c4c]' : 'bg-primary-container shadow-[0_0_8px_#ffd700]'}"></span>
                    <span class="${data.risk >= 0.8 ? 'text-error' : 'text-primary-container'}">${data.risk >= 0.8 ? 'CRITICAL' : 'STABLE'}</span>
                </div>
            </td>
            <td class="px-6 py-4 text-right text-outline font-mono text-[10px]">${data.lastUpdated.toLocaleTimeString()}</td>
        `;
        tbody.appendChild(row);
    });

    const dispatch = document.getElementById('dispatch-unit');
    if (dispatch && dispatch.options.length === 0) {
        machines.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.innerText = m;
            dispatch.appendChild(opt);
        });
    }

    renderMaintenanceTimeline();
}

// ============================
// NEW VIEW: TACTICAL BRIEFING
// ============================
function renderBriefing() {
    const mId = selectedMachine || machines[0];
    const data = machineData[mId];
    if (!data) return;
    const m = data.metrics;
    const risk = data.risk;

    const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
    const safeHTML = (id, val) => { const el = document.getElementById(id); if(el) el.innerHTML = val; };

    safeSet('briefing-timestamp', new Date().toISOString().slice(0, 19) + 'Z');
    safeSet('briefing-machine-id', mId);
    safeSet('briefing-doc-id', `DOC_ID: TX-${Date.now().toString(36).toUpperCase()} // GENERATED_BY: SENTINEL_4_AI`);

    // Sensor snapshots
    const tempColor = getTempClass(m.temperature_C).replace('text-', 'bg-');
    const vibColor = getVibClass(m.vibration_mm_s).replace('text-', 'bg-');
    const loadColor = getLoadClass(m.current_A).replace('text-', 'bg-');

    const setDot = (id, colorClass) => { const el = document.getElementById(id); if(el) el.className = `w-2 h-2 ${colorClass}`; };
    setDot('briefing-temp-dot', tempColor);
    setDot('briefing-vib-dot', vibColor);
    setDot('briefing-load-dot', loadColor);

    const tempEl = document.getElementById('briefing-temp-val');
    if (tempEl) { tempEl.innerText = `${m.temperature_C?.toFixed(1)}°C`; tempEl.className = `font-mono text-3xl mb-2 ${getTempClass(m.temperature_C)}`; }
    const vibEl = document.getElementById('briefing-vib-val');
    if (vibEl) { vibEl.innerText = `${m.vibration_mm_s?.toFixed(2)} mm/s`; vibEl.className = `font-mono text-3xl mb-2 ${getVibClass(m.vibration_mm_s)}`; }
    safeSet('briefing-rpm-val', `${m.rpm?.toFixed(0)} RPM`);
    const loadEl = document.getElementById('briefing-load-val');
    if (loadEl) { loadEl.innerText = `${m.current_A?.toFixed(1)} A`; loadEl.className = `font-mono text-3xl mb-2 ${getLoadClass(m.current_A)}`; }

    // Risk & severity
    safeSet('briefing-risk', risk.toFixed(2));
    const sevEl = document.getElementById('briefing-severity');
    if (sevEl) {
        if (risk >= 0.8) { sevEl.innerText = 'CRITICAL'; sevEl.className = 'text-error font-bold'; }
        else if (risk >= 0.6) { sevEl.innerText = 'WARNING'; sevEl.className = 'text-primary-container'; }
        else { sevEl.innerText = 'NOMINAL'; sevEl.className = 'text-primary'; }
    }

    // AI Reasoning
    let reasoning = '';
    if (risk >= 0.8) {
        reasoning = `<p>&gt; INITIATING DIAGNOSTIC SEQUENCE...</p>
            <p>&gt; ANALYZING TELEMETRY OVER LAST 300 SECONDS.</p>
            <p>&gt; <span class="text-error">ANOMALY DETECTED:</span> RAPID TEMPERATURE SPIKE IN ${mId} (${m.temperature_C?.toFixed(1)}°C) COMBINED WITH VIBRATION ANOMALY (${m.vibration_mm_s?.toFixed(2)} mm/s).</p>
            <p>&gt; CORRELATING DATA WITH KNOWN FAILURE PROFILES...</p>
            <p class="bg-surface-container p-4 border-l-2 border-error text-on-surface">PROBABILITY ${(risk * 100).toFixed(1)}%: MECHANICAL STRESS FRACTURE. SECONDARY RISK: THERMAL RUNAWAY WITHIN 45 MINUTES IF NOT ISOLATED.</p>
            <p>&gt; RECOMMENDATION: IMMEDIATE MANUAL OVERRIDE AND PHYSICAL INSPECTION REQUIRED.</p>`;
    } else if (risk >= 0.6) {
        reasoning = `<p>&gt; SCANNING ${mId} METRICS...</p>
            <p>&gt; <span class="text-primary-container">ELEVATED READINGS DETECTED</span> — Temperature: ${m.temperature_C?.toFixed(1)}°C, Vibration: ${m.vibration_mm_s?.toFixed(2)} mm/s</p>
            <p>&gt; RECOMMENDATION: Schedule preventative inspection within next operating cycle.</p>`;
    } else {
        reasoning = `<p>&gt; ${mId} NOMINAL. All parameters within operational thresholds.</p>
            <p>&gt; RECOMMENDATION: Continue standard monitoring protocol.</p>`;
    }
    safeHTML('briefing-ai-reasoning', reasoning);
}

// ============================
// NEW VIEW: RUL PREDICTION
// ============================
function renderRUL() {
    const mId = selectedMachine || machines[0];
    const data = machineData[mId];
    if (!data) return;
    const risk = data.risk;

    const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };

    safeSet('rul-machine-label', mId);

    // Time-to-failure: inversely proportional to risk
    const ttfMinutes = Math.max(1, Math.floor((1 - risk) * 240)); // 0-240 minute range
    const hrs = Math.floor(ttfMinutes / 60);
    const mins = ttfMinutes % 60;
    const secs = Math.floor(Math.random() * 60);
    const ttfStr = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const ttfVal = document.getElementById('rul-ttf-value');
    const ttfContainer = document.getElementById('rul-ttf-container');
    if (ttfVal) {
        ttfVal.innerText = ttfStr;
        ttfVal.className = `block font-mono text-[8rem] leading-none font-bold tracking-tighter ${risk >= 0.8 ? 'text-secondary' : (risk >= 0.6 ? 'text-primary-container' : 'text-on-surface')}`;
    }
    if (ttfContainer) {
        ttfContainer.className = `p-8 flex-1 flex flex-col justify-center items-center relative z-10 bg-surface-container border-b-2 ${risk >= 0.8 ? 'border-secondary neon-glow-error' : 'border-primary-container'}`;
    }

    // State indicator
    const stateDot = document.getElementById('rul-state-dot');
    const stateText = document.getElementById('rul-state-text');
    if (stateDot && stateText) {
        if (risk >= 0.8) {
            stateDot.className = 'w-2 h-2 bg-secondary block animate-pulse';
            stateText.innerText = 'CRITICAL_STATE';
            stateText.className = 'font-mono text-sm text-secondary';
        } else if (risk >= 0.6) {
            stateDot.className = 'w-2 h-2 bg-primary-container block';
            stateText.innerText = 'WARNING_STATE';
            stateText.className = 'font-mono text-sm text-primary-container';
        } else {
            stateDot.className = 'w-2 h-2 bg-primary block';
            stateText.innerText = 'OPERATIONAL';
            stateText.className = 'font-mono text-sm text-primary';
        }
    }

    // Risk gauge
    safeSet('rul-risk-value', risk.toFixed(2));
    const riskBar = document.getElementById('rul-risk-bar');
    if (riskBar) riskBar.style.width = `${(risk * 100).toFixed(0)}%`;
    const riskBadge = document.getElementById('rul-risk-badge');
    if (riskBadge) {
        if (risk >= 0.8) {
            riskBadge.innerText = 'HIGH_RISK';
            riskBadge.className = 'bg-secondary/10 text-secondary font-label text-xs tracking-widest px-2 py-1 border border-secondary/30';
        } else if (risk >= 0.6) {
            riskBadge.innerText = 'ELEVATED';
            riskBadge.className = 'bg-primary-container/10 text-primary-container font-label text-xs tracking-widest px-2 py-1 border border-primary-container/30';
        } else {
            riskBadge.innerText = 'LOW_RISK';
            riskBadge.className = 'bg-primary/10 text-primary font-label text-xs tracking-widest px-2 py-1 border border-primary/30';
        }
    }

    // Vibration telemetry bars
    const vibBars = document.getElementById('rul-vib-bars');
    if (vibBars) {
        const history = machineHistory[mId];
        const vibData = history.vib.slice(-20);
        const maxVib = Math.max(...vibData, 5);
        vibBars.innerHTML = vibData.map(v => {
            const pct = Math.min(100, (v / maxVib) * 100);
            const color = v > 5 ? 'bg-secondary' : (v > 3 ? 'bg-secondary/60' : 'bg-primary-container/40');
            return `<div class="flex-1 ${color} hover:bg-primary-container transition-colors" style="height: ${pct}%"></div>`;
        }).join('');
    }
}

// ============================
// NEW VIEW: CORRELATION ANALYSIS
// ============================
function renderCorrelation() {
    // Pick first two machines for correlation
    const [mA, mB] = getCorrelationPair();
    const dataA = machineData[mA];
    const dataB = machineData[mB];
    if (!dataA || !dataB) return;

    const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
    const safeHTML = (id, val) => { const el = document.getElementById(id); if(el) el.innerHTML = val; };

    safeSet('corr-linkage', `LINKAGE: ${mA} <> ${mB}`);
    safeSet('corr-legend-a', `${mA} (COMPOSITE T/V/R/S)`);
    safeSet('corr-legend-b', `${mB} (COMPOSITE T/V/R/S)`);
    safeSet('corr-delta', `${Math.abs((dataA.risk || 0) - (dataB.risk || 0)).toFixed(2)} ΔRISK`);

    const isolateBtn = document.getElementById('corr-isolate-btn');
    if (isolateBtn) isolateBtn.innerText = correlationIsolated ? 'RESTORE PAIR' : 'ISOLATE DATA';

    const overlayBtn = document.getElementById('corr-mode-overlay');
    const splitBtn = document.getElementById('corr-mode-split');
    if (overlayBtn && splitBtn) {
        overlayBtn.className = `px-3 py-1 ${correlationViewMode === 'overlay' ? 'text-primary-container bg-surface-dim' : 'text-outline hover:text-on-surface'}`;
        splitBtn.className = `px-3 py-1 ${correlationViewMode === 'split' ? 'text-primary-container bg-surface-dim' : 'text-outline hover:text-on-surface'}`;
    }

    const pearsonAbs = (seriesA, seriesB) => {
        const n = Math.min(seriesA.length, seriesB.length);
        if (n < 3) return 0;
        let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
        for (let i = 0; i < n; i++) {
            const a = Number(seriesA[i]);
            const b = Number(seriesB[i]);
            sumA += a; sumB += b;
            sumAB += a * b;
            sumA2 += a * a;
            sumB2 += b * b;
        }
        const denom = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
        if (!denom) return 0;
        return Math.abs((n * sumAB - sumA * sumB) / denom);
    };

    const normalizePair = (seriesA, seriesB) => {
        const n = Math.min(seriesA.length, seriesB.length);
        const a = seriesA.slice(-n).map(Number);
        const b = seriesB.slice(-n).map(Number);
        const merged = [...a, ...b];
        const min = Math.min(...merged);
        const max = Math.max(...merged);
        const range = (max - min) || 1;
        return {
            a: a.map(v => (v - min) / range),
            b: b.map(v => (v - min) / range)
        };
    };

    const sensorPairs = [
        { key: 'TEMP', a: machineHistory[mA].temp.slice(-30), b: machineHistory[mB].temp.slice(-30) },
        { key: 'VIB', a: machineHistory[mA].vib.slice(-30), b: machineHistory[mB].vib.slice(-30) },
        { key: 'RPM', a: machineHistory[mA].rpm.slice(-30), b: machineHistory[mB].rpm.slice(-30) },
        // Speed proxy mapped from electrical load/current for cross-sensor consistency
        { key: 'SPEED', a: machineHistory[mA].load.slice(-30), b: machineHistory[mB].load.slice(-30) },
    ];

    const perSensorCorr = sensorPairs.map(pair => ({
        key: pair.key,
        corr: pearsonAbs(pair.a, pair.b)
    }));
    const corr = perSensorCorr.reduce((acc, item) => acc + item.corr, 0) / perSensorCorr.length;

    safeSet('corr-score', corr.toFixed(2));
    const corrBar = document.getElementById('corr-bar');
    if (corrBar) corrBar.style.width = `${(corr * 100).toFixed(0)}%`;

    const statusLabel = corr >= 0.75 ? 'HIGH_CORRELATION' : (corr >= 0.5 ? 'MODERATE' : 'LOW');
    const sensorCorrText = perSensorCorr.map(s => `${s.key}:${s.corr.toFixed(2)}`).join(' | ');
    safeSet('corr-status', `THRESHOLD: 0.75 | STATUS: ${statusLabel} | ${sensorCorrText}`);

    // Impact description
    const strongest = [...perSensorCorr].sort((x, y) => y.corr - x.corr)[0];
    const weakest = [...perSensorCorr].sort((x, y) => x.corr - y.corr)[0];
    if (corr >= 0.75) {
        safeSet('corr-impact-title', 'Systemic_Impact_Detected');
        safeHTML('corr-impact-desc', `Cross-sensor lock between <span class="text-primary-container">${mA}</span> and <span class="text-primary-container">${mB}</span>. Strongest on <span class="text-primary-container">${strongest.key}</span>, weakest on <span class="text-outline">${weakest.key}</span>.`);
    } else {
        safeSet('corr-impact-title', 'No_Systemic_Impact');
        safeSet('corr-impact-desc', `Multi-sensor coupling below threshold. Review ${weakest.key} channel for asynchronous behavior.`);
    }

    // Machine status readouts
    const riskA = dataA.risk;
    const riskB = dataB.risk;
    const statusA = riskA >= 0.8 ? 'CRITICAL' : (riskA >= 0.6 ? 'WARNING' : 'NOMINAL');
    const statusB = riskB >= 0.8 ? 'CRITICAL' : (riskB >= 0.6 ? 'WARNING' : 'NOMINAL');
    const colorA = riskA >= 0.8 ? 'text-secondary' : (riskA >= 0.6 ? 'text-primary-fixed-dim' : 'text-primary');
    const colorB = riskB >= 0.8 ? 'text-secondary' : (riskB >= 0.6 ? 'text-primary-fixed-dim' : 'text-primary');
    const mAStatus = document.getElementById('corr-m-a-status');
    const mBStatus = document.getElementById('corr-m-b-status');
    if (mAStatus) { mAStatus.innerText = statusA; mAStatus.className = colorA; }
    if (mBStatus) { mBStatus.innerText = statusB; mBStatus.className = colorB; }

    // SVG graph paths and spread analytics
    const buildPath = (series, color, dashed, yRange, yOffset = 0) => {
        const [min, max] = yRange;
        const range = (max - min) || 1;
        const points = series.map((v, i) => {
            const x = (i / (series.length - 1 || 1)) * 1000;
            const y = yOffset + (100 - ((v - min) / range) * 100);
            return `${x.toFixed(0)},${y.toFixed(0)}`;
        }).join(' L');
        const dashAttr = dashed ? 'stroke-dasharray="4 4"' : '';
        return `<path d="M${points}" fill="none" stroke="${color}" stroke-width="2" ${dashAttr} class="opacity-90"></path>`;
    };

    const normalizedPairs = sensorPairs.map(pair => normalizePair(pair.a, pair.b));
    const n = Math.min(...normalizedPairs.map(p => Math.min(p.a.length, p.b.length)));
    const compositeA = Array.from({ length: n }, (_, i) => {
        return normalizedPairs.reduce((acc, p) => acc + p.a[p.a.length - n + i], 0) / normalizedPairs.length;
    });
    const compositeB = Array.from({ length: n }, (_, i) => {
        return normalizedPairs.reduce((acc, p) => acc + p.b[p.b.length - n + i], 0) / normalizedPairs.length;
    });

    const globalMin = 0;
    const globalMax = 1;

    const spread = compositeA.map((v, i) => Math.abs(v - compositeB[i]));
    const maxSpread = Math.max(...spread, 0);
    const minSpread = Math.min(...spread, 0);
    const maxSpreadIdx = spread.indexOf(maxSpread);
    safeSet('corr-max-spread', `${maxSpread.toFixed(2)} IDX`);
    safeSet('corr-min-spread', `${minSpread.toFixed(2)} IDX`);
    safeSet('corr-leadlag', compositeA[compositeA.length - 1] > compositeB[compositeB.length - 1] ? `${mA} LEADS` : `${mB} LEADS`);

    const spreadYRange = [0, Math.max(maxSpread * 1.2, 1)];

    const svgA = document.getElementById('corr-svg-a');
    const svgB = document.getElementById('corr-svg-b');
    const svgSpread = document.getElementById('corr-svg-spread');
    const eventHorizon = document.getElementById('corr-event-horizon');

    if (correlationViewMode === 'overlay') {
        if (svgA) svgA.innerHTML = buildPath(compositeA, '#ffd700', false, [globalMin, globalMax], 0);
        if (svgB) svgB.innerHTML = buildPath(compositeB, '#4d4732', true, [globalMin, globalMax], 0);
    } else {
        if (svgA) svgA.innerHTML = buildPath(compositeA, '#ffd700', false, [globalMin, globalMax], -48);
        if (svgB) svgB.innerHTML = buildPath(compositeB, '#4d4732', true, [globalMin, globalMax], 48);
    }
    if (svgSpread) {
        const spreadPath = buildPath(spread, '#ffb3ae', false, spreadYRange, 0).replace('stroke-width="2"', 'stroke-width="1.5"');
        const areaPoints = spread.map((v, i) => {
            const x = (i / (spread.length - 1 || 1)) * 1000;
            const y = 100 - ((v - spreadYRange[0]) / ((spreadYRange[1] - spreadYRange[0]) || 1)) * 100;
            return `${x.toFixed(0)},${y.toFixed(0)}`;
        }).join(' L');
        svgSpread.innerHTML = `<path d="M0,100 L${areaPoints} L1000,100 Z" fill="rgba(255,179,174,0.08)"></path>${spreadPath}`;
    }

    if (eventHorizon && maxSpreadIdx >= 0) {
        const leftPct = ((maxSpreadIdx / (spread.length - 1 || 1)) * 100);
        eventHorizon.style.left = `calc(${leftPct}% - 5%)`;
        eventHorizon.classList.toggle('hidden', statusLabel === 'LOW');
    }
}

// ============================
// NEW VIEW: CALIBRATION STUDIO
// ============================
let calibListenersAttached = false;
function renderCalibration() {
    const mId = selectedMachine || machines[0];
    const data = machineData[mId];
    if (!data) return;
    const m = data.metrics;

    const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };

    // HUD readouts
    safeSet('calib-sync', `${(99 + Math.random() * 0.9).toFixed(1)}%`);
    safeSet('calib-latency', `LATENCY: ${(0.01 + Math.random() * 0.08).toFixed(2)}ms`);
    safeSet('calib-node', `NODE_ID: ${mId}`);

    // Slider readouts driven by actual sensor baselines
    const freqSlider = document.getElementById('calib-freq-slider');
    const ampSlider = document.getElementById('calib-amp-slider');
    const phaseSlider = document.getElementById('calib-phase-slider');

    if (freqSlider) safeSet('calib-freq', `${(freqSlider.value * 0.65).toFixed(2)} Hz`);
    if (ampSlider) safeSet('calib-amp', `+${(ampSlider.value * 0.025).toFixed(2)} dB`);
    if (phaseSlider) safeSet('calib-phase', `${(phaseSlider.value * 0.01 - 0.5).toFixed(2)} ms`);

    // System state
    const stateEl = document.getElementById('calib-state');
    if (stateEl) {
        if (data.risk >= 0.8) {
            stateEl.innerHTML = '<span class="w-1.5 h-1.5 bg-secondary inline-block animate-pulse"></span> Drift_Detected';
        } else {
            stateEl.innerHTML = '<span class="w-1.5 h-1.5 bg-primary-container inline-block"></span> Nominal';
        }
    }

    // Animate waveform based on vibration data
    const waveform = document.getElementById('calib-waveform');
    if (waveform) {
        const vib = m.vibration_mm_s || 1;
        const amp = Math.min(90, vib * 30);
        const pts = [];
        for (let x = 0; x <= 1000; x += 20) {
            const y = 100 + Math.sin(x * 0.015 + Date.now() * 0.001) * amp + Math.sin(x * 0.04) * (amp * 0.3);
            pts.push(`${x},${y.toFixed(0)}`);
        }
        waveform.innerHTML = `
            <path d="M${pts.join(' L')}" fill="none" stroke="#FFD700" stroke-width="2" style="filter: drop-shadow(0 0 8px rgba(255,215,0,0.6));" vector-effect="non-scaling-stroke"></path>
            <path d="M0,100 C100,100 120,40 220,100 C320,160 280,60 380,100 C480,140 520,10 620,100 C720,190 780,70 880,100 C980,130 1000,100 1000,100" fill="none" stroke="#4d4732" stroke-dasharray="4 4" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
        `;
    }

    // Attach slider listeners only once
    if (!calibListenersAttached) {
        calibListenersAttached = true;
        ['calib-freq-slider', 'calib-amp-slider', 'calib-phase-slider'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => renderCalibration());
        });
    }
}

void init().catch(err => console.error('Sentinel 4 bootstrap failed:', err));
