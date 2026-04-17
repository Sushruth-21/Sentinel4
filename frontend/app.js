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
let eventSources = {};
let machineHistory = {};
let forensicCharts = {}; // Changed from singular forensicChart
let analysisCharts = {};
let analysisMeterCharts = {};
const MAX_HISTORY = 50;
const CRITICAL_THRESHOLD = 0.8;
const WARNING_THRESHOLD = 0.6;
const ANALYSIS_METRICS = ['temperature_C', 'vibration_mm_s', 'rpm', 'current_A'];
const analysisState = {
    scope: 'all',
    focusMachine: machines[0],
    metric: 'temperature_C',
    startTime: '',
    endTime: '',
    sortDirection: 'desc'
};
const HISTORY_API_URL = 'http://127.0.0.1:8010/api/history';
const historySidebarState = {
    records: [],
    selectedRecordId: null,
    selectedRecordType: 'telemetry',
    machineFilter: 'all',
    sortBy: 'timestamp',
    sortDirection: 'desc',
    loading: false,
    error: ''
};
let historyMinuteRefreshIntervalId = null;
let historyMinuteAlignTimeoutId = null;
const HISTORY_REFRESH_MS = 30000;
const metricMeta = {
    temperature_C: { label: 'Temperature', unit: '°C', color: '#ff4c4c', max: 160 },
    vibration_mm_s: { label: 'Vibration', unit: 'mm/s', color: '#ffd700', max: 12 },
    rpm: { label: 'RPM', unit: 'RPM', color: '#72ebff', max: 3000 },
    current_A: { label: 'Current', unit: 'A', color: '#ffb3ae', max: 25 }
};
const sensorMap = [
    { key: 'temperature_C', fn: getTempClass, label: 'TEMP' },
    { key: 'vibration_mm_s', fn: getVibClass, label: 'VIB' },
    { key: 'rpm', fn: (v) => 'text-on-background', label: 'RPM' }, // RPM is nominal for now
    { key: 'current_A', fn: getLoadClass, label: 'LOAD' }
];

// Initialization
function init() {
    machines.forEach(m => {
        machineData[m] = {
            id: m,
            metrics: { ...baseValues[m] },
            risk: 0.15,
            isMaintenance: false,
            lastUpdated: new Date()
        };
        // Initialize history buffer
        machineHistory[m] = {
            labels: Array(MAX_HISTORY).fill(''),
            timestamps: Array(MAX_HISTORY).fill(''),
            temp: Array(MAX_HISTORY).fill(baseValues[m].temperature_C),
            vib: Array(MAX_HISTORY).fill(baseValues[m].vibration_mm_s),
            rpm: Array(MAX_HISTORY).fill(baseValues[m].rpm),
            load: Array(MAX_HISTORY).fill(baseValues[m].current_A)
        };
    });

    setupEventListeners();
    
    // Attempt to connect to live simulation server (malendau-hackathon)
    connectToLiveStreams();
    
    // Fallback/Parallel simulation for UI consistency
    startLocalSimulation();
    startHistoryMinuteAutoRefresh();
    
    renderAll();
    void loadHistorySidebar();
}

function startHistoryMinuteAutoRefresh() {
    if (historyMinuteAlignTimeoutId) {
        clearTimeout(historyMinuteAlignTimeoutId);
        historyMinuteAlignTimeoutId = null;
    }
    if (historyMinuteRefreshIntervalId) {
        clearInterval(historyMinuteRefreshIntervalId);
        historyMinuteRefreshIntervalId = null;
    }

    const runRefresh = () => {
        if (activeView === 'history') {
            void loadHistorySidebar();
        }
    };

    const msToNextTick = HISTORY_REFRESH_MS - (Date.now() % HISTORY_REFRESH_MS);
    historyMinuteAlignTimeoutId = setTimeout(() => {
        runRefresh();
        historyMinuteRefreshIntervalId = setInterval(runRefresh, HISTORY_REFRESH_MS);
    }, msToNextTick);
}

function connectToLiveStreams() {
    machines.forEach((mId) => openStreamForMachine(mId));
}

function openStreamForMachine(mId) {
    if (!machineData[mId] || machineData[mId].isMaintenance) return;

    if (eventSources[mId]) {
        eventSources[mId].close();
        delete eventSources[mId];
    }

    try {
        const es = new EventSource(`http://localhost:3000/stream/${mId}`);
        es.onmessage = (e) => {
            const reading = JSON.parse(e.data);
            updateMachineData(mId, reading);
        };
        es.onerror = () => {
            console.warn(`Could not connect to live stream for ${mId}. Ensure sim-server is running on :3000`);
        };
        eventSources[mId] = es;
    } catch (err) {
        console.error(`SSE Initialization failed for ${mId}`);
    }
}

function updateMachineData(mId, reading) {
    if (!machineData[mId]) return;
    if (machineData[mId].isMaintenance) return;
    
    machineData[mId].metrics = { ...reading };
    machineData[mId].lastUpdated = new Date(reading.timestamp);

    // Update history buffer
    const history = machineHistory[mId];
    history.labels.push(new Date(reading.timestamp).toLocaleTimeString());
    history.timestamps.push(reading.timestamp);
    history.temp.push(reading.temperature_C);
    history.vib.push(reading.vibration_mm_s);
    history.rpm.push(reading.rpm);
    history.load.push(reading.current_A);

    if (history.labels.length > MAX_HISTORY) {
        history.labels.shift();
        history.timestamps.shift();
        history.temp.shift();
        history.vib.shift();
        history.rpm.shift();
        history.load.shift();
    }
    
    // In a live environment, the risk would come from the backend.
    calculateClientRisk(mId);
    
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'diagnostics' && selectedMachine === mId) {
        renderDiagnostics();
        updateForensicChart();
    }
    if (activeView === 'analysis') renderAnalysis();
    if (activeView === 'history') renderHistoryView();
}

function calculateClientRisk(mId) {
    const metrics = machineData[mId].metrics;
    const base = baseValues[mId];
    let risk = 0.1;
    
    if (metrics.temperature_C > base.temperature_C * 1.2) risk += 0.4;
    if (metrics.vibration_mm_s > base.vibration_mm_s * 2.0) risk += 0.4;

    const prevRisk = machineData[mId].risk;
    machineData[mId].risk = Math.min(1.0, risk);

    // Trigger alert if risk rises above the critical threshold
    if (machineData[mId].risk > CRITICAL_THRESHOLD && prevRisk <= CRITICAL_THRESHOLD) {
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
        type: 'critical'
    };
    alerts.unshift(alert);
    if (alerts.length > 5) alerts.pop();
    renderAlertFeed();
    
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
            <p class="text-[10px] font-bold text-on-surface uppercase mb-1">${alert.title}</p>
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

    const dispatchStopBtn = document.getElementById('dispatch-stop-btn');
    if (dispatchStopBtn) {
        dispatchStopBtn.addEventListener('click', sendMachineToMaintenance);
    }

    const restartMachineBtn = document.getElementById('restart-machine-btn');
    if (restartMachineBtn) {
        restartMachineBtn.addEventListener('click', restartDispatchedMachine);
    }

    const analysisControls = ['analysis-scope', 'analysis-focus-machine', 'analysis-metric', 'analysis-start', 'analysis-end', 'analysis-sort'];
    analysisControls.forEach((id) => {
        const control = document.getElementById(id);
        if (control) {
            control.addEventListener('change', syncAnalysisFilters);
        }
    });

    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => exportAnalysis('csv'));

    const exportJsonBtn = document.getElementById('export-json-btn');
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => exportAnalysis('json'));

    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', () => exportAnalysis('pdf'));

    const historyMachineFilter = document.getElementById('history-machine-filter');
    if (historyMachineFilter) historyMachineFilter.addEventListener('change', () => {
        historySidebarState.machineFilter = historyMachineFilter.value;
        void loadHistorySidebar();
    });

    const historySortBy = document.getElementById('history-sort-by');
    if (historySortBy) historySortBy.addEventListener('change', () => {
        historySidebarState.sortBy = historySortBy.value;
        void loadHistorySidebar();
    });

    const historySortDirection = document.getElementById('history-sort-direction');
    if (historySortDirection) historySortDirection.addEventListener('change', () => {
        historySidebarState.sortDirection = historySortDirection.value;
        void loadHistorySidebar();
    });

    const historyRefreshBtn = document.getElementById('history-refresh-btn');
    if (historyRefreshBtn) historyRefreshBtn.addEventListener('click', () => void loadHistorySidebar());

    const historySaveCurrentBtn = document.getElementById('history-save-current-btn');
    if (historySaveCurrentBtn) historySaveCurrentBtn.addEventListener('click', () => void saveCurrentMachineSnapshot());

    const historyDeleteFilteredBtn = document.getElementById('history-delete-filtered-btn');
    if (historyDeleteFilteredBtn) historyDeleteFilteredBtn.addEventListener('click', () => void deleteFilteredHistoryRecords());

    const historyExportCsvBtn = document.getElementById('history-export-csv-btn');
    if (historyExportCsvBtn) historyExportCsvBtn.addEventListener('click', () => exportHistory('csv'));

    const historyExportJsonBtn = document.getElementById('history-export-json-btn');
    if (historyExportJsonBtn) historyExportJsonBtn.addEventListener('click', () => exportHistory('json'));

    const historyExportPdfBtn = document.getElementById('history-export-pdf-btn');
    if (historyExportPdfBtn) historyExportPdfBtn.addEventListener('click', () => exportHistory('pdf'));
}

function getSelectedDispatchMachine() {
    const dispatch = document.getElementById('dispatch-unit');
    if (!dispatch || !dispatch.value) return null;
    return dispatch.value;
}

async function logHistoryOperationEvent(machineId, eventType, status, severity, message, details = {}) {
    try {
        await fetch(`${HISTORY_API_URL}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                machine_id: machineId,
                event_type: eventType,
                status,
                severity,
                message,
                timestamp: new Date().toISOString(),
                details
            })
        });
    } catch (_) {
        // Keep UI operations non-blocking if history API is unavailable.
    }
}

function sendMachineToMaintenance() {
    const mId = getSelectedDispatchMachine();
    if (!mId || !machineData[mId]) return;
    if (machineData[mId].isMaintenance) return;

    machineData[mId].isMaintenance = true;
    machineData[mId].risk = Math.min(machineData[mId].risk, WARNING_THRESHOLD);

    if (eventSources[mId]) {
        eventSources[mId].close();
        delete eventSources[mId];
    }

    void logHistoryOperationEvent(
        mId,
        'maintenance_dispatch',
        'MAINTENANCE',
        'warning',
        'Machine dispatched to maintenance mode',
        { risk: machineData[mId].risk, action: 'dispatch_stop' }
    );

    renderAll();
    void loadHistorySidebar();
}

function restartDispatchedMachine() {
    const mId = getSelectedDispatchMachine();
    if (!mId || !machineData[mId]) return;
    if (!machineData[mId].isMaintenance) return;

    machineData[mId].isMaintenance = false;
    openStreamForMachine(mId);
    void logHistoryOperationEvent(
        mId,
        'maintenance_restart',
        'OPERATIONAL',
        'info',
        'Machine restarted from maintenance mode',
        { risk: machineData[mId].risk, action: 'restart_machine' }
    );
    renderAll();
    void loadHistorySidebar();
}

function switchView(viewId) {
    activeView = viewId;
    document.querySelectorAll('.content-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    if (viewId === 'history') {
        void loadHistorySidebar();
    }
    renderAll();
}

function startLocalSimulation() {
    // If SSE isn't working, this keeps the UI "alive"
    setInterval(() => {
        machines.forEach(m => {
            if (machineData[m].isMaintenance) return;
            if (machineData[m].lastUpdated && (new Date() - machineData[m].lastUpdated < 2000)) return; // Don't override fresh SSE data
            
            sensorKeys.forEach(s => {
                const noise = (Math.random() - 0.5) * (baseValues[m][s] * 0.05);
                machineData[m].metrics[s] = Math.max(0, machineData[m].metrics[s] + noise);
            });
            // Fake history for local sim
            const mData = machineData[m].metrics;
            updateMachineData(m, {
                timestamp: new Date().toISOString(),
                machine_id: m,
                temperature_C: mData.temperature_C,
                vibration_mm_s: mData.vibration_mm_s,
                rpm: mData.rpm,
                current_A: mData.current_A
            });
        });
    }, 3000);
}

function renderAll() {
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'diagnostics') renderDiagnostics();
    if (activeView === 'maintenance') renderMaintenance();
    if (activeView === 'analysis') renderAnalysis();
    if (activeView === 'history') renderHistoryView();
}

function getStatusColor(risk) {
    if (risk > CRITICAL_THRESHOLD) return 'error';
    if (risk >= WARNING_THRESHOLD) return 'secondary';
    return 'primary-container';
}

function getStatusLabelFromRisk(risk, isMaintenance = false) {
    if (isMaintenance) return 'MAINTENANCE';
    if (risk > CRITICAL_THRESHOLD) return 'CRITICAL';
    if (risk >= WARNING_THRESHOLD) return 'WARNING';
    return 'STABLE';
}

function getMachineSnapshot(machineId) {
    const data = machineData[machineId];
    if (!data) {
        return {
            machineId,
            risk: 0,
            status: 'UNKNOWN',
            isMaintenance: false,
            lastUpdated: '',
            metrics: {}
        };
    }

    return {
        machineId,
        risk: Number(data.risk || 0),
        status: getStatusLabelFromRisk(Number(data.risk || 0), Boolean(data.isMaintenance)),
        isMaintenance: Boolean(data.isMaintenance),
        lastUpdated: data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : '',
        metrics: {
            temperature_C: Number(data.metrics.temperature_C || 0),
            vibration_mm_s: Number(data.metrics.vibration_mm_s || 0),
            rpm: Number(data.metrics.rpm || 0),
            current_A: Number(data.metrics.current_A || 0)
        }
    };
}

function getTempClass(v) { return v > 100 ? 'text-error' : (v > 85 ? 'text-primary-container' : 'text-on-background'); }
function getVibClass(v)  { return v > 5   ? 'text-error' : (v > 3 ? 'text-primary-container' : 'text-on-background'); }
function getLoadClass(v) { return v > 22  ? 'text-error' : (v > 18 ? 'text-primary-container' : 'text-on-background'); }

function syncAnalysisFilters() {
    const scope = document.getElementById('analysis-scope');
    const focusMachine = document.getElementById('analysis-focus-machine');
    const metric = document.getElementById('analysis-metric');
    const startTime = document.getElementById('analysis-start');
    const endTime = document.getElementById('analysis-end');
    const sortDirection = document.getElementById('analysis-sort');

    analysisState.scope = scope ? scope.value : analysisState.scope;
    analysisState.focusMachine = focusMachine && focusMachine.value ? focusMachine.value : analysisState.focusMachine;
    analysisState.metric = metric ? metric.value : analysisState.metric;
    analysisState.startTime = startTime ? startTime.value : analysisState.startTime;
    analysisState.endTime = endTime ? endTime.value : analysisState.endTime;
    analysisState.sortDirection = sortDirection ? sortDirection.value : analysisState.sortDirection;

    renderAnalysis();
}

function renderHistoryMinuteTable() {
    const tbody = document.getElementById('history-minute-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    historySidebarState.records.forEach((record) => {
        const status = record.status || getStatusLabelFromRisk(Number(record.risk || 0));
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-surface-container-high transition-colors cursor-pointer';
        tr.innerHTML = `
            <td class="px-4 py-3 text-outline">${getHistoryDateLabel(record.minute_start || record.timestamp)}</td>
            <td class="px-4 py-3 text-on-surface font-bold">${status}</td>
            <td class="px-4 py-3 text-on-surface">${Number(record.temperature || 0).toFixed(2)} C</td>
            <td class="px-4 py-3 text-on-surface-variant">${Number(record.temperature_min || 0).toFixed(2)} / ${Number(record.temperature_max || 0).toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${Number(record.vibration || 0).toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface-variant">${Number(record.vibration_min || 0).toFixed(2)} / ${Number(record.vibration_max || 0).toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${Number(record.rpm || 0).toFixed(0)}</td>
            <td class="px-4 py-3 text-on-surface-variant">${Number(record.rpm_min || 0).toFixed(0)} / ${Number(record.rpm_max || 0).toFixed(0)}</td>
            <td class="px-4 py-3 text-on-surface">${Number(record.current || 0).toFixed(2)} A</td>
            <td class="px-4 py-3 text-on-surface-variant">${Number(record.current_min || 0).toFixed(2)} / ${Number(record.current_max || 0).toFixed(2)}</td>
        `;
        tr.addEventListener('click', () => {
            historySidebarState.selectedRecordId = record.id;
            historySidebarState.selectedRecordType = record.record_type || 'minute';
            renderHistorySidebar();
        });
        tbody.appendChild(tr);
    });
}

function renderHistoryView() {
    renderHistorySidebar();
    renderHistoryMinuteTable();
}

function getHistoryDateLabel(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString();
}

function toApiDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
}

function getSelectedHistoryRecord() {
    return historySidebarState.records.find(
        (record) => record.id === historySidebarState.selectedRecordId
    ) || null;
}

function renderHistoryDetails() {
    const detail = document.getElementById('history-detail');
    if (!detail) return;

    const selected = getSelectedHistoryRecord();
    if (!selected) {
        detail.innerText = 'Select a row from history to inspect machine-level details.';
        return;
    }

    const payload = selected.payload || {};
    const status = selected.status || getStatusLabelFromRisk(Number(selected.risk || 0));
    const minuteStart = selected.minute_start || selected.timestamp;
    const minuteEnd = selected.minute_end || selected.timestamp;
    detail.innerHTML = `
        <div><span class="text-outline">ID:</span> <span class="text-on-surface">${selected.id}</span></div>
        <div><span class="text-outline">Record Type:</span> <span class="text-on-surface">${selected.record_type || 'minute'}</span></div>
        <div><span class="text-outline">Event Type:</span> <span class="text-on-surface">${selected.event_type || 'minute_summary'}</span></div>
        <div><span class="text-outline">Machine:</span> <span class="text-on-surface">${selected.machine_id}</span></div>
        <div><span class="text-outline">Status:</span> <span class="text-on-surface">${status}</span></div>
        <div><span class="text-outline">Minute Window:</span> <span class="text-on-surface">${getHistoryDateLabel(minuteStart)} -> ${getHistoryDateLabel(minuteEnd)}</span></div>
        <div><span class="text-outline">Message:</span> <span class="text-on-surface">${selected.message || '1-minute machine summary'}</span></div>
        <div><span class="text-outline">Sample Count:</span> <span class="text-on-surface">${Number(selected.sample_count || 0)}</span></div>
        <div><span class="text-outline">Risk:</span> <span class="text-on-surface">${Number(selected.risk || 0).toFixed(2)}</span></div>
        <div><span class="text-outline">Temperature:</span> <span class="text-on-surface">${Number(selected.temperature || 0).toFixed(2)} C (Min ${Number(selected.temperature_min || 0).toFixed(2)} / Max ${Number(selected.temperature_max || 0).toFixed(2)})</span></div>
        <div><span class="text-outline">Vibration:</span> <span class="text-on-surface">${Number(selected.vibration || 0).toFixed(2)} mm/s (Min ${Number(selected.vibration_min || 0).toFixed(2)} / Max ${Number(selected.vibration_max || 0).toFixed(2)})</span></div>
        <div><span class="text-outline">RPM:</span> <span class="text-on-surface">${Number(selected.rpm || 0).toFixed(0)} (Min ${Number(selected.rpm_min || 0).toFixed(0)} / Max ${Number(selected.rpm_max || 0).toFixed(0)})</span></div>
        <div><span class="text-outline">Current:</span> <span class="text-on-surface">${Number(selected.current || 0).toFixed(2)} A (Min ${Number(selected.current_min || 0).toFixed(2)} / Max ${Number(selected.current_max || 0).toFixed(2)})</span></div>
        <div><span class="text-outline">Payload:</span></div>
        <pre class="mt-1 whitespace-pre-wrap break-all text-[9px] leading-relaxed text-on-surface-variant">${JSON.stringify(payload, null, 2)}</pre>
    `;
}

function renderHistorySidebar() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    const countNode = document.getElementById('history-count');
    const machineFilter = document.getElementById('history-machine-filter');
    const sortBy = document.getElementById('history-sort-by');
    const sortDirection = document.getElementById('history-sort-direction');

    if (!list || !empty || !countNode) return;

    if (machineFilter) {
        if (machineFilter.options.length < machines.length) {
            machineFilter.innerHTML = '';
            machines.forEach((mId) => {
                const opt = document.createElement('option');
                opt.value = mId;
                opt.innerText = mId;
                machineFilter.appendChild(opt);
            });
        }
        if (machines.includes(analysisState.focusMachine)) {
            historySidebarState.machineFilter = analysisState.focusMachine;
        }
        machineFilter.value = historySidebarState.machineFilter;
    }
    if (sortBy) sortBy.value = historySidebarState.sortBy;
    if (sortDirection) sortDirection.value = historySidebarState.sortDirection;

    list.innerHTML = '';

    if (historySidebarState.loading) {
        list.innerHTML = '<div class="text-[10px] font-mono text-outline uppercase">Loading history from database...</div>';
        empty.classList.add('hidden');
        countNode.innerText = 'loading';
        renderHistoryDetails();
        return;
    }

    if (historySidebarState.error) {
        list.innerHTML = `<div class="text-[10px] font-mono text-error uppercase">${historySidebarState.error}</div>`;
        empty.classList.add('hidden');
        countNode.innerText = 'error';
        renderHistoryDetails();
        return;
    }

    const records = historySidebarState.records;
    countNode.innerText = `${records.length} rows`;

    if (!records.length) {
        empty.classList.remove('hidden');
        renderHistoryDetails();
        return;
    }

    empty.classList.add('hidden');

    records.forEach((record) => {
        const row = document.createElement('div');
        const isActive = historySidebarState.selectedRecordId === record.id;
        row.className = `history-row ${isActive ? 'active' : ''}`;

        const risk = Number(record.risk || 0);
        const riskClass = risk >= CRITICAL_THRESHOLD ? 'text-error' : (risk >= WARNING_THRESHOLD ? 'text-primary-container' : 'text-on-surface');
        const status = record.status || getStatusLabelFromRisk(risk);
        const eventType = String(record.event_type || 'minute_summary').toUpperCase();
        const message = record.message || '1-minute machine summary';

        row.innerHTML = `
            <div class="flex items-center justify-between gap-2 mb-1">
                <span class="text-[10px] font-headline font-bold tracking-widest text-primary-container uppercase">${record.machine_id}</span>
                <span class="text-[10px] font-mono ${riskClass}">${risk.toFixed(2)}</span>
            </div>
            <div class="flex items-center justify-between gap-2 mb-1">
                <span class="text-[9px] font-mono text-secondary uppercase">${eventType}</span>
                <span class="text-[9px] font-mono text-on-surface uppercase">${status}</span>
            </div>
            <div class="text-[9px] font-mono text-outline mb-1">${getHistoryDateLabel(record.timestamp)}</div>
            <div class="text-[9px] font-mono text-on-surface-variant mb-1">${message}</div>
            <div class="grid grid-cols-2 gap-1 text-[9px] font-mono text-on-surface-variant">
                <span>T: ${Number(record.temperature || 0).toFixed(1)} C</span>
                <span>T[min/max]: ${Number(record.temperature_min || 0).toFixed(1)}/${Number(record.temperature_max || 0).toFixed(1)}</span>
                <span>V: ${Number(record.vibration || 0).toFixed(2)}</span>
                <span>V[min/max]: ${Number(record.vibration_min || 0).toFixed(2)}/${Number(record.vibration_max || 0).toFixed(2)}</span>
                <span>R: ${Number(record.rpm || 0).toFixed(0)}</span>
                <span>R[min/max]: ${Number(record.rpm_min || 0).toFixed(0)}/${Number(record.rpm_max || 0).toFixed(0)}</span>
                <span>C: ${Number(record.current || 0).toFixed(1)}</span>
                <span>C[min/max]: ${Number(record.current_min || 0).toFixed(1)}/${Number(record.current_max || 0).toFixed(1)}</span>
            </div>
        `;

        row.addEventListener('click', (event) => {
            historySidebarState.selectedRecordId = record.id;
            historySidebarState.selectedRecordType = record.record_type || 'minute';
            renderHistorySidebar();
        });

        list.appendChild(row);
    });

    if (!historySidebarState.selectedRecordId && records.length) {
        historySidebarState.selectedRecordId = records[0].id;
        historySidebarState.selectedRecordType = records[0].record_type || 'minute';
    } else if (historySidebarState.selectedRecordId && !records.some((r) => r.id === historySidebarState.selectedRecordId)) {
        historySidebarState.selectedRecordId = records[0]?.id || null;
        historySidebarState.selectedRecordType = records[0]?.record_type || 'minute';
    }

    renderHistoryDetails();
}

async function loadHistorySidebar() {
    if (!historySidebarState.machineFilter || historySidebarState.machineFilter === 'all') {
        historySidebarState.machineFilter = machines[0];
    }

    const params = new URLSearchParams();
    params.set('machine_id', historySidebarState.machineFilter);

    const start = toApiDateTime(analysisState.startTime);
    const end = toApiDateTime(analysisState.endTime);
    if (start) params.set('start', start);
    if (end) params.set('end', end);

    params.set('mode', 'minute');
    params.set('sort_direction', historySidebarState.sortDirection);
    params.set('limit', '500');

    historySidebarState.loading = true;
    historySidebarState.error = '';
    renderHistorySidebar();

    try {
        const response = await fetch(`${HISTORY_API_URL}?${params.toString()}`);
        if (!response.ok) throw new Error(`History request failed (${response.status})`);
        const payload = await response.json();
        historySidebarState.records = Array.isArray(payload.records) ? payload.records : [];
    } catch (error) {
        historySidebarState.records = [];
        historySidebarState.error = 'Unable to reach history API. Start backend main.py first.';
    } finally {
        historySidebarState.loading = false;
        renderHistorySidebar();
        renderHistoryMinuteTable();
    }
}

async function saveCurrentMachineSnapshot() {
    const machineId = historySidebarState.machineFilter && historySidebarState.machineFilter !== 'all'
        ? historySidebarState.machineFilter
        : (machines.includes(analysisState.focusMachine) ? analysisState.focusMachine : machines[0]);

    const machine = machineData[machineId];
    if (!machine || !machine.metrics) {
        window.alert('No live machine data available to save yet.');
        return;
    }

    const payload = {
        machine_id: machineId,
        timestamp: new Date().toISOString(),
        temperature: Number(machine.metrics.temperature_C || 0),
        vibration: Number(machine.metrics.vibration_mm_s || 0),
        rpm: Number(machine.metrics.rpm || 0),
        current: Number(machine.metrics.current_A || 0),
        risk: Number(machine.risk || 0),
        status: getStatusLabelFromRisk(Number(machine.risk || 0), Boolean(machine.isMaintenance))
    };

    try {
        const response = await fetch(`${HISTORY_API_URL}/snapshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`Save snapshot failed (${response.status})`);
        }
        await loadHistorySidebar();
    } catch (error) {
        window.alert('Unable to save current machine data. Ensure backend is running.');
    }
}

async function deleteSingleHistoryRecord(readingId, recordType = 'telemetry') {
    const row = historySidebarState.records.find((record) => record.id === readingId && (record.record_type || 'telemetry') === recordType);
    const label = row ? `${row.machine_id} @ ${getHistoryDateLabel(row.timestamp)}` : `record ${readingId}`;
    const ok = window.confirm(`Delete this history row?\n${label}\n\nThis cannot be undone.`);
    if (!ok) return;

    try {
        const response = await fetch(`${HISTORY_API_URL}/${recordType}/${readingId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`Delete failed (${response.status})`);
        await loadHistorySidebar();
    } catch (error) {
        window.alert('Delete failed. Please try again.');
    }
}

async function deleteFilteredHistoryRecords() {
    if (!historySidebarState.records.length) return;

    const machine = historySidebarState.machineFilter === 'all' ? 'ALL MACHINES' : historySidebarState.machineFilter;
    const start = analysisState.startTime || 'earliest';
    const end = analysisState.endTime || 'latest';
    const ok = window.confirm(
        `Delete filtered history rows?\nMachine: ${machine}\nWindow: ${start} -> ${end}\nRows: ${historySidebarState.records.length}\n\nThis cannot be undone.`
    );
    if (!ok) return;

    const params = new URLSearchParams();
    if (historySidebarState.machineFilter !== 'all') params.set('machine_id', historySidebarState.machineFilter);
    const startIso = toApiDateTime(analysisState.startTime);
    const endIso = toApiDateTime(analysisState.endTime);
    if (startIso) params.set('start', startIso);
    if (endIso) params.set('end', endIso);

    try {
        const response = await fetch(`${HISTORY_API_URL}?${params.toString()}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`Delete failed (${response.status})`);
        await loadHistorySidebar();
    } catch (error) {
        window.alert('Bulk delete failed. Please try again.');
    }
}

function getHistoryExportRecords() {
    const selected = getSelectedHistoryRecord();
    if (selected) {
        return historySidebarState.records.filter((record) => record.machine_id === selected.machine_id);
    }
    return historySidebarState.records;
}

function exportHistory(format) {
    const records = getHistoryExportRecords();
    if (!records.length) {
        window.alert('No history records available to export.');
        return;
    }

    const selected = getSelectedHistoryRecord();
    const machine = selected ? selected.machine_id : 'all-machines';
    const nowStamp = Date.now();

    if (format === 'csv') {
        const headers = ['id', 'record_type', 'event_type', 'minute_start', 'minute_end', 'timestamp', 'machine_id', 'status', 'message', 'sample_count', 'machine_live_risk', 'temperature', 'temperature_min', 'temperature_max', 'vibration', 'vibration_min', 'vibration_max', 'rpm', 'rpm_min', 'rpm_max', 'current', 'current_min', 'current_max', 'record_risk', 'risk_min', 'risk_max'];
        const rows = [headers.join(',')];
        records.forEach((record) => {
            const snapshot = getMachineSnapshot(record.machine_id);
            const recordRisk = Number(record.risk || 0);
            rows.push([
                record.id,
                record.record_type || 'minute',
                record.event_type || 'minute_summary',
                record.minute_start || record.timestamp,
                record.minute_end || record.timestamp,
                getHistoryDateLabel(record.timestamp),
                record.machine_id,
                record.status || getStatusLabelFromRisk(recordRisk, snapshot.isMaintenance),
                record.message || '1-minute machine summary',
                Number(record.sample_count || 0),
                snapshot.risk.toFixed(2),
                Number(record.temperature || 0).toFixed(2),
                Number(record.temperature_min || 0).toFixed(2),
                Number(record.temperature_max || 0).toFixed(2),
                Number(record.vibration || 0).toFixed(2),
                Number(record.vibration_min || 0).toFixed(2),
                Number(record.vibration_max || 0).toFixed(2),
                Number(record.rpm || 0).toFixed(0),
                Number(record.rpm_min || 0).toFixed(0),
                Number(record.rpm_max || 0).toFixed(0),
                Number(record.current || 0).toFixed(2),
                Number(record.current_min || 0).toFixed(2),
                Number(record.current_max || 0).toFixed(2),
                recordRisk.toFixed(2),
                Number(record.risk_min || 0).toFixed(2),
                Number(record.risk_max || 0).toFixed(2)
            ].map(escapeCsvValue).join(','));
        });
        downloadTextFile(`sentinel4-history-${machine}-${nowStamp}.csv`, 'text/csv;charset=utf-8', rows.join('\n'));
        return;
    }

    if (format === 'json') {
        const enriched = records.map((record) => {
            const snapshot = getMachineSnapshot(record.machine_id);
            return {
                ...record,
                status: record.status || getStatusLabelFromRisk(Number(record.risk || 0), snapshot.isMaintenance),
                machineSnapshot: snapshot
            };
        });
        downloadTextFile(
            `sentinel4-history-${machine}-${nowStamp}.json`,
            'application/json;charset=utf-8',
            JSON.stringify({ machine, exportedAt: new Date().toISOString(), records: enriched }, null, 2)
        );
        return;
    }

    if (format === 'pdf') {
        const pdfCtor = window.jspdf && window.jspdf.jsPDF;
        if (!pdfCtor) {
            window.alert('PDF library not available.');
            return;
        }

        const doc = new pdfCtor({ orientation: 'p', unit: 'pt', format: 'a4' });
        const margin = 36;
        const pageHeight = doc.internal.pageSize.getHeight();
        let y = margin;

        const ensureSpace = (neededHeight) => {
            if (y + neededHeight > pageHeight - margin) {
                doc.addPage();
                y = margin;
            }
        };

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('SENTINEL 4 MACHINE HISTORY REPORT', margin, y);
        y += 18;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
        y += 12;
        doc.text(`Machine Scope: ${machine}`, margin, y);
        y += 12;
        doc.text(`Rows: ${records.length}`, margin, y);
        y += 18;

        const machineSet = [...new Set(records.map((record) => record.machine_id))];
        ensureSpace(16 + machineSet.length * 12);
        doc.setFont('helvetica', 'bold');
        doc.text('Machine Information and Status', margin, y);
        y += 12;
        doc.setFont('helvetica', 'normal');
        machineSet.forEach((machineId) => {
            const snap = getMachineSnapshot(machineId);
            ensureSpace(12);
            doc.text(
                `${snap.machineId} | ${snap.status} | Risk ${snap.risk.toFixed(2)} | Temp ${snap.metrics.temperature_C.toFixed(2)} C | Vib ${snap.metrics.vibration_mm_s.toFixed(2)} | RPM ${snap.metrics.rpm.toFixed(0)} | Current ${snap.metrics.current_A.toFixed(2)} A`,
                margin,
                y
            );
            y += 12;
        });
        y += 8;

        records.forEach((record, index) => {
            const snapshot = getMachineSnapshot(record.machine_id);
            const status = record.status || getStatusLabelFromRisk(Number(record.risk || 0), snapshot.isMaintenance);
            const eventType = record.event_type || 'minute_summary';
            ensureSpace(56);
            doc.setFont('helvetica', 'bold');
            doc.text(`${index + 1}. ${record.machine_id} | ${eventType.toUpperCase()} | ${status} | ${getHistoryDateLabel(record.minute_start || record.timestamp)}`, margin, y);
            y += 12;

            doc.setFont('helvetica', 'normal');
            doc.text(
                `${record.message || '1-minute machine summary'} | Samples ${Number(record.sample_count || 0)} | Temp ${Number(record.temperature || 0).toFixed(2)} C [${Number(record.temperature_min || 0).toFixed(2)}..${Number(record.temperature_max || 0).toFixed(2)}] | Vib ${Number(record.vibration || 0).toFixed(2)} [${Number(record.vibration_min || 0).toFixed(2)}..${Number(record.vibration_max || 0).toFixed(2)}] | RPM ${Number(record.rpm || 0).toFixed(0)} [${Number(record.rpm_min || 0).toFixed(0)}..${Number(record.rpm_max || 0).toFixed(0)}] | Current ${Number(record.current || 0).toFixed(2)} [${Number(record.current_min || 0).toFixed(2)}..${Number(record.current_max || 0).toFixed(2)}] | Risk ${Number(record.risk || 0).toFixed(2)}`,
                margin,
                y
            );
            y += 16;
        });

        doc.save(`sentinel4-history-${machine}-${nowStamp}.pdf`);
    }
}

function ensureAnalysisSelectors() {
    const focusMachine = document.getElementById('analysis-focus-machine');
    if (focusMachine && focusMachine.options.length === 0) {
        machines.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = m;
            focusMachine.appendChild(opt);
        });
    }

    const scope = document.getElementById('analysis-scope');
    const metric = document.getElementById('analysis-metric');
    const startTime = document.getElementById('analysis-start');
    const endTime = document.getElementById('analysis-end');
    const sortDirection = document.getElementById('analysis-sort');

    if (scope) scope.value = analysisState.scope;
    if (focusMachine) focusMachine.value = analysisState.focusMachine;
    if (metric) metric.value = analysisState.metric;
    if (startTime && !startTime.value) startTime.value = analysisState.startTime;
    if (endTime && !endTime.value) endTime.value = analysisState.endTime;
    if (sortDirection) sortDirection.value = analysisState.sortDirection;
}

function getMetricUnit(metricKey) {
    return metricMeta[metricKey]?.unit || '';
}

function getMetricLabel(metricKey) {
    return metricMeta[metricKey]?.label || metricKey;
}

function getMetricColor(metricKey) {
    return metricMeta[metricKey]?.color || '#ffd700';
}

function getMetricMax(metricKey) {
    return metricMeta[metricKey]?.max || 100;
}

function getMachineRecords(mId) {
    const history = machineHistory[mId];
    if (!history) return [];

    const start = analysisState.startTime ? new Date(analysisState.startTime).getTime() : null;
    const end = analysisState.endTime ? new Date(analysisState.endTime).getTime() : null;

    const records = history.timestamps
        .map((timestamp, index) => ({
            machineId: mId,
            timestamp,
            date: timestamp ? new Date(timestamp) : null,
            temperature_C: history.temp[index],
            vibration_mm_s: history.vib[index],
            rpm: history.rpm[index],
            current_A: history.load[index]
        }))
        .filter((record) => record.date && !Number.isNaN(record.date.getTime()))
        .filter((record) => {
            const stamp = record.date.getTime();
            if (start !== null && stamp < start) return false;
            if (end !== null && stamp > end) return false;
            return true;
        });

    records.sort((a, b) => {
        const diff = a.date - b.date;
        return analysisState.sortDirection === 'asc' ? diff : -diff;
    });

    return records;
}

function getAnalysisRecords() {
    const mIds = analysisState.scope === 'machine' ? [analysisState.focusMachine] : machines;
    return mIds.flatMap((mId) => getMachineRecords(mId));
}

function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
    if (values.length <= 1) return 0;
    const avg = mean(values);
    const variance = mean(values.map((value) => (value - avg) ** 2));
    return Math.sqrt(variance);
}

function calculateZScore(value, values) {
    const deviation = stdDev(values);
    if (!values.length || deviation === 0) return 0;
    return (value - mean(values)) / deviation;
}

function getLatestRecord(records) {
    if (!records.length) return null;
    return records.reduce((latest, record) => {
        if (!latest) return record;
        return record.date > latest.date ? record : latest;
    }, null);
}

function getCurrentValue(record, metricKey) {
    if (!record) return 0;
    return Number(record[metricKey] || 0);
}

function summarizeMachine(mId) {
    const records = getMachineRecords(mId);
    const latest = getLatestRecord(records);
    const metric = analysisState.metric;
    const metricValues = records.map((record) => Number(record[metric] || 0));
    const latestValue = latest ? Number(latest[metric] || 0) : 0;
    const sortedByTime = [...records].sort((a, b) => a.date - b.date);

    const summary = {
        machineId: mId,
        zScore: calculateZScore(latestValue, metricValues),
        latestValue,
        lastSeen: latest ? latest.date : null,
        metrics: {}
    };

    ANALYSIS_METRICS.forEach((metricKey) => {
        const values = records.map((record) => Number(record[metricKey] || 0));
        summary.metrics[metricKey] = {
            peak: values.length ? Math.max(...values) : 0,
            min: values.length ? Math.min(...values) : 0,
            latest: latest ? Number(latest[metricKey] || 0) : 0,
            zScore: metricKey === metric ? calculateZScore(latest ? Number(latest[metricKey] || 0) : 0, values) : calculateZScore(latest ? Number(latest[metricKey] || 0) : 0, values)
        };
    });

    summary.series = sortedByTime;
    return summary;
}

function renderGauge(chart, value, maxValue, color) {
    if (!chart) return;
    const safeMax = Math.max(maxValue, value * 1.2, 1);
    chart.data.datasets[0].data = [Math.max(0, value), Math.max(safeMax - value, 0)];
    chart.data.datasets[0].backgroundColor = [color, '#2a2a2a'];
    chart.options.plugins.legend.display = false;
    chart.update('none');
}

function initAnalysisCharts() {
    if (Object.keys(analysisCharts).length) return;

    const baseLineConfig = (label, color) => ({
        type: 'line',
        data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: color + '22', fill: true, tension: 0.25, borderWidth: 2, pointRadius: 0 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#999077', maxRotation: 0, autoSkip: true }, grid: { color: '#4d473211' } },
                y: { ticks: { color: '#999077' }, grid: { color: '#4d473211' } }
            }
        }
    });

    const gaugeConfig = (label) => ({
        type: 'doughnut',
        data: { labels: [label, 'Remaining'], datasets: [{ data: [0, 1], borderWidth: 0, cutout: '72%', circumference: 180, rotation: 270, backgroundColor: ['#ffd700', '#2a2a2a'] }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } }
        }
    });

    analysisMeterCharts.current = new Chart(document.getElementById('analysis-meter-current').getContext('2d'), gaugeConfig('Current'));
    analysisMeterCharts.temperature = new Chart(document.getElementById('analysis-meter-temperature').getContext('2d'), gaugeConfig('Temperature'));
    analysisMeterCharts.rpm = new Chart(document.getElementById('analysis-meter-rpm').getContext('2d'), gaugeConfig('RPM'));
    analysisMeterCharts.vibration = new Chart(document.getElementById('analysis-meter-vibration').getContext('2d'), gaugeConfig('Vibration'));

    analysisCharts.temperature = new Chart(document.getElementById('analysis-chart-temperature').getContext('2d'), baseLineConfig('Temperature', getMetricColor('temperature_C')));
    analysisCharts.vibration = new Chart(document.getElementById('analysis-chart-vibration').getContext('2d'), baseLineConfig('Vibration', getMetricColor('vibration_mm_s')));
    analysisCharts.rpm = new Chart(document.getElementById('analysis-chart-rpm').getContext('2d'), baseLineConfig('RPM', getMetricColor('rpm')));
    analysisCharts.current = new Chart(document.getElementById('analysis-chart-current').getContext('2d'), baseLineConfig('Current', getMetricColor('current_A')));
    analysisCharts.zscoreLine = new Chart(document.getElementById('analysis-chart-zscore-line').getContext('2d'), baseLineConfig('Z-Score', '#9cf0ff'));
    analysisCharts.zscoreBar = new Chart(document.getElementById('analysis-chart-zscore-bar').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Z-Score', data: [], backgroundColor: '#ffd700' }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#999077' }, grid: { color: '#4d473211' } },
                y: { ticks: { color: '#999077' }, grid: { color: '#4d473211' } }
            }
        }
    });
}

function updateAnalysisCharts(summary, records) {
    const focusMachine = summary.machineId;
    const focusMetric = analysisState.metric;
    const series = summary.series;
    const labels = series.map((record) => record.date.toLocaleString());

    const metricSeries = (metricKey) => series.map((record) => Number(record[metricKey] || 0));

    analysisCharts.temperature.data.labels = labels;
    analysisCharts.temperature.data.datasets[0].data = metricSeries('temperature_C');
    analysisCharts.temperature.update('none');

    analysisCharts.vibration.data.labels = labels;
    analysisCharts.vibration.data.datasets[0].data = metricSeries('vibration_mm_s');
    analysisCharts.vibration.update('none');

    analysisCharts.rpm.data.labels = labels;
    analysisCharts.rpm.data.datasets[0].data = metricSeries('rpm');
    analysisCharts.rpm.update('none');

    analysisCharts.current.data.labels = labels;
    analysisCharts.current.data.datasets[0].data = metricSeries('current_A');
    analysisCharts.current.update('none');

    const metricValues = metricSeries(focusMetric);
    const zSeries = metricValues.map((value, index, arr) => calculateZScore(value, arr));
    analysisCharts.zscoreLine.data.labels = labels;
    analysisCharts.zscoreLine.data.datasets[0].data = zSeries;
    analysisCharts.zscoreLine.data.datasets[0].borderColor = getMetricColor(focusMetric);
    analysisCharts.zscoreLine.data.datasets[0].backgroundColor = getMetricColor(focusMetric) + '22';
    analysisCharts.zscoreLine.update('none');

    const zScoresByMachine = machines.map((mId) => {
        const machineRecords = getMachineRecords(mId);
        const values = machineRecords.map((record) => Number(record[focusMetric] || 0));
        const latest = getLatestRecord(machineRecords);
        const latestValue = latest ? Number(latest[focusMetric] || 0) : 0;
        return calculateZScore(latestValue, values);
    });
    analysisCharts.zscoreBar.data.labels = machines;
    analysisCharts.zscoreBar.data.datasets[0].data = zScoresByMachine;
    analysisCharts.zscoreBar.data.datasets[0].backgroundColor = machines.map((mId) => (mId === focusMachine ? '#ff4c4c' : '#ffd700'));
    analysisCharts.zscoreBar.update('none');

    const latest = getLatestRecord(series);
    const latestMetricValue = latest ? Number(latest[focusMetric] || 0) : 0;
    const latestMax = series.length ? Math.max(...metricValues) : getMetricMax(focusMetric);
    renderGauge(analysisMeterCharts.current, latest ? Number(latest.current_A || 0) : 0, getMetricMax('current_A'), getMetricColor('current_A'));
    renderGauge(analysisMeterCharts.temperature, latest ? Number(latest.temperature_C || 0) : 0, getMetricMax('temperature_C'), getMetricColor('temperature_C'));
    renderGauge(analysisMeterCharts.rpm, latest ? Number(latest.rpm || 0) : 0, getMetricMax('rpm'), getMetricColor('rpm'));
    renderGauge(analysisMeterCharts.vibration, latest ? Number(latest.vibration_mm_s || 0) : 0, getMetricMax('vibration_mm_s'), getMetricColor('vibration_mm_s'));

    const meterValues = {
        current: latest ? Number(latest.current_A || 0) : 0,
        temperature: latest ? Number(latest.temperature_C || 0) : 0,
        rpm: latest ? Number(latest.rpm || 0) : 0,
        vibration: latest ? Number(latest.vibration_mm_s || 0) : 0
    };
    const setMeterText = (id, value, unit) => {
        const el = document.getElementById(id);
        if (el) el.innerText = `${Number(value).toFixed(unit === 'RPM' ? 0 : 2)}${unit}`.replace(/\.00(?=[A-Za-z°])/,'');
    };
    setMeterText('analysis-meter-current-value', meterValues.current, 'A');
    setMeterText('analysis-meter-temperature-value', meterValues.temperature, '°C');
    setMeterText('analysis-meter-rpm-value', meterValues.rpm, 'RPM');
    setMeterText('analysis-meter-vibration-value', meterValues.vibration, 'mm/s');

    const selectedZScore = calculateZScore(latestMetricValue, metricValues);
    const zScoreNode = document.getElementById('analysis-selected-zscore');
    if (zScoreNode) zScoreNode.innerText = selectedZScore.toFixed(2);
    const machineCountNode = document.getElementById('analysis-machine-count');
    if (machineCountNode) machineCountNode.innerText = String(new Set(records.map((record) => record.machineId)).size || 0);
    const recordCountNode = document.getElementById('analysis-record-count');
    if (recordCountNode) recordCountNode.innerText = String(records.length);
}

function renderAnalysisSummary() {
    const tbody = document.getElementById('analysis-summary-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = machines.map((mId) => summarizeMachine(mId));
    const relevantRows = analysisState.scope === 'machine' ? rows.filter((row) => row.machineId === analysisState.focusMachine) : rows;

    relevantRows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-surface-container-high transition-colors';
        tr.innerHTML = `
            <td class="px-4 py-3 font-bold text-on-surface">${row.machineId}</td>
            <td class="px-4 py-3 text-primary-container font-bold">${row.zScore.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.temperature_C.peak.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.temperature_C.min.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.vibration_mm_s.peak.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.vibration_mm_s.min.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.rpm.peak.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.rpm.min.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.current_A.peak.toFixed(2)}</td>
            <td class="px-4 py-3 text-on-surface">${row.metrics.current_A.min.toFixed(2)}</td>
            <td class="px-4 py-3 text-right text-outline font-mono text-[10px]">${row.lastSeen ? row.lastSeen.toLocaleString() : '--'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderAnalysis() {
    ensureAnalysisSelectors();
    initAnalysisCharts();

    const scope = analysisState.scope;
    const focusMachine = machines.includes(analysisState.focusMachine) ? analysisState.focusMachine : machines[0];
    analysisState.focusMachine = focusMachine;

    const records = getAnalysisRecords();
    const summary = summarizeMachine(focusMachine);

    const sessionRange = document.getElementById('analysis-session-range');
    if (sessionRange) {
        const start = analysisState.startTime || 'earliest';
        const end = analysisState.endTime || 'latest';
        sessionRange.innerText = `Session Window: ${start} -> ${end} | Scope: ${scope}`;
    }

    updateAnalysisCharts(summary, records);
    renderAnalysisSummary();
    renderHistorySidebar();
}

function buildAnalysisPayload() {
    const records = getAnalysisRecords();
    const summaries = machines.map((mId) => summarizeMachine(mId));
    const machineSnapshots = machines.map((mId) => getMachineSnapshot(mId));
    return {
        filters: { ...analysisState },
        records,
        summaries,
        machineSnapshots
    };
}

function downloadTextFile(filename, mimeType, content) {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}

function escapeCsvValue(value) {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function exportAnalysis(format) {
    const payload = buildAnalysisPayload();

    if (format === 'csv') {
        const headers = ['machineId', 'machineStatus', 'machineRisk', 'timestamp', 'temperature_C', 'vibration_mm_s', 'rpm', 'current_A', 'zScore'];
        const csvRows = [headers.join(',')];
        payload.records.forEach((record) => {
            const machineSummary = summarizeMachine(record.machineId);
            const machineSnapshot = getMachineSnapshot(record.machineId);
            csvRows.push([
                record.machineId,
                machineSnapshot.status,
                machineSnapshot.risk.toFixed(2),
                record.timestamp,
                record.temperature_C,
                record.vibration_mm_s,
                record.rpm,
                record.current_A,
                machineSummary.zScore.toFixed(2)
            ].map(escapeCsvValue).join(','));
        });
        downloadTextFile(`sentinel4-analysis-${Date.now()}.csv`, 'text/csv;charset=utf-8', csvRows.join('\n'));
        return;
    }

    if (format === 'json') {
        downloadTextFile(
            `sentinel4-analysis-${Date.now()}.json`,
            'application/json;charset=utf-8',
            JSON.stringify(payload, null, 2)
        );
        return;
    }

    if (format === 'pdf') {
        const pdfCtor = window.jspdf && window.jspdf.jsPDF;
        if (!pdfCtor) return;

        const doc = new pdfCtor({ orientation: 'l', unit: 'pt', format: 'a4' });
        let y = 36;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 36;

        const ensureSpace = (needed) => {
            if (y + needed > pageHeight - margin) {
                doc.addPage();
                y = margin;
            }
        };

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('SENTINEL 4 ANALYSE REPORT', margin, y);
        y += 18;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
        y += 14;
        doc.text(`Scope: ${analysisState.scope} | Focus: ${analysisState.focusMachine} | Metric: ${getMetricLabel(analysisState.metric)}`, margin, y);
        y += 18;

        ensureSpace(100);
        doc.text(`Records: ${payload.records.length}`, margin, y);
        y += 12;
        doc.text(`Machines: ${payload.summaries.length}`, margin, y);
        y += 18;

        const focusSnapshot = getMachineSnapshot(analysisState.focusMachine);
        ensureSpace(70);
        doc.setFont('helvetica', 'bold');
        doc.text('Focus Machine Info', margin, y);
        y += 12;
        doc.setFont('helvetica', 'normal');
        doc.text(
            `${focusSnapshot.machineId} | Status: ${focusSnapshot.status} | Risk: ${focusSnapshot.risk.toFixed(2)} | Last Updated: ${focusSnapshot.lastUpdated || '--'}`,
            margin,
            y
        );
        y += 12;
        doc.text(
            `Temp ${focusSnapshot.metrics.temperature_C.toFixed(2)} C | Vib ${focusSnapshot.metrics.vibration_mm_s.toFixed(2)} mm/s | RPM ${focusSnapshot.metrics.rpm.toFixed(0)} | Current ${focusSnapshot.metrics.current_A.toFixed(2)} A`,
            margin,
            y
        );
        y += 18;

        const meterText = {
            current: document.getElementById('analysis-meter-current-value')?.innerText || '--A',
            temperature: document.getElementById('analysis-meter-temperature-value')?.innerText || '--°C',
            rpm: document.getElementById('analysis-meter-rpm-value')?.innerText || '--RPM',
            vibration: document.getElementById('analysis-meter-vibration-value')?.innerText || '--mm/s'
        };
        ensureSpace(60);
        doc.setFont('helvetica', 'bold');
        doc.text('Meter Values', margin, y);
        y += 12;
        doc.setFont('helvetica', 'normal');
        doc.text(
            `Current: ${meterText.current} | Temperature: ${meterText.temperature} | RPM: ${meterText.rpm} | Vibration: ${meterText.vibration}`,
            margin,
            y
        );
        y += 18;

        ensureSpace(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Machine Status Snapshot', margin, y);
        y += 12;
        doc.setFont('helvetica', 'normal');
        payload.machineSnapshots.forEach((machine) => {
            ensureSpace(12);
            doc.text(
                `${machine.machineId} | ${machine.status} | Risk ${Number(machine.risk).toFixed(2)} | Updated ${machine.lastUpdated || '--'}`,
                margin,
                y
            );
            y += 12;
        });
        y += 8;

        const chartIds = [
            'analysis-meter-current',
            'analysis-meter-temperature',
            'analysis-meter-rpm',
            'analysis-meter-vibration',
            'analysis-chart-temperature',
            'analysis-chart-vibration',
            'analysis-chart-rpm',
            'analysis-chart-current',
            'analysis-chart-zscore-line',
            'analysis-chart-zscore-bar'
        ];

        chartIds.forEach((id) => {
            const canvas = document.getElementById(id);
            if (!canvas) return;
            const image = canvas.toDataURL('image/png');
            const isMeter = id.includes('meter');
            const width = isMeter ? 200 : 360;
            const height = isMeter ? 110 : 180;
            ensureSpace(height + 18);
            doc.addImage(image, 'PNG', margin, y, width, height);
            y += height + 12;
        });

        doc.save(`sentinel4-analysis-${Date.now()}.pdf`);
    }
}

function renderDashboard() {
    const grid = document.getElementById('machine-grid');
    if (!grid) return;
    grid.innerHTML = '';

    machines.forEach(m => {
        const data = machineData[m];
        const isMaintenance = data.isMaintenance;
        const color = isMaintenance ? 'outline' : getStatusColor(data.risk);
        const borderClass = isMaintenance ? 'border-secondary' : (data.risk > CRITICAL_THRESHOLD ? 'border-error' : 'border-primary-container');
        const levelText = isMaintenance ? 'MAINTENANCE' : (data.risk > CRITICAL_THRESHOLD ? 'CRITICAL' : (data.risk >= WARNING_THRESHOLD ? 'WARNING' : 'OPERATIONAL'));
        const levelClass = isMaintenance ? 'bg-outline text-background' : `bg-${color} text-on-${color}`;

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
                <span class="${levelClass} px-2 py-1 text-[9px] font-black uppercase">${levelText}</span>
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
                    <polyline fill="none" points="${generateSparklinePoints(machineHistory[m].temp)}" stroke="${isMaintenance ? '#999077' : (data.risk > CRITICAL_THRESHOLD ? '#ff4c4c' : '#ffd700')}" stroke-width="2"></polyline>
                </svg>
            </div>
        `;
        grid.appendChild(card);
    });

    renderHeatmap();
    renderAlertFeed();
}

function generateSparklinePoints(values) {
    if (!values || values.length === 0) return '0,20 100,20';

    const samples = values.slice(-10);
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const range = max - min || 1;
    const step = samples.length > 1 ? 100 / (samples.length - 1) : 100;

    return samples
        .map((value, index) => {
            const x = Math.round(index * step * 10) / 10;
            const normalized = (value - min) / range;
            const y = Math.round((34 - normalized * 28) * 10) / 10;
            return `${x},${y}`;
        })
        .join(' ');
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
    const mId = selectedMachine || machines[0];
    const data = machineData[mId];

    document.getElementById('diag-machine-id').innerText = mId;
    document.getElementById('diag-case-ref').innerText = `CASE_REF: AX-${mId}-${Math.floor(Math.random()*9000)+1000}`;
    
    const color = data.isMaintenance ? 'secondary' : getStatusColor(data.risk);
    const statusText = data.isMaintenance
        ? 'MAINTENANCE_MODE'
        : (data.risk > CRITICAL_THRESHOLD ? 'CRITICAL_FAILURE_POSSIBLE' : (data.risk >= WARNING_THRESHOLD ? 'WARNING_STRESS' : 'STABLE_NODE'));
    
    document.getElementById('diag-status').innerText = `Status: ${statusText}`;
    document.getElementById('diag-status').className = `text-sm font-headline font-bold uppercase text-${color}`;
    document.getElementById('diag-header-card').className = `bg-surface-container-low p-6 border-l-4 border-${color}`;

    const narrative = document.getElementById('ai-narrative');
    if (data.isMaintenance) {
        narrative.innerHTML = `Machine ${mId} is currently in maintenance mode. <br/><br/> Live telemetry intake is paused until restart.`;
    } else if (data.risk > CRITICAL_THRESHOLD) {
        narrative.innerHTML = `Analysis reveals abnormal oscillation in ${mId}. <br/><br/> Recommendation: Inspect bearing casing. Thermal drift (${data.metrics.temperature_C?.toFixed(1)}°C) suggests internal friction.`;
    } else {
        narrative.innerHTML = `Machine ${mId} is operating within nominal parameters. <br/><br/> Recommendation: Routine maintenance cycle maintained.`;
    }

    if (Object.keys(forensicCharts).length === 0) initForensicCharts();
}

function initForensicCharts() {
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
        const maintenanceState = data.isMaintenance;
        const row = document.createElement('tr');
        row.className = 'hover:bg-surface-container-high transition-colors';
        row.innerHTML = `
            <td class="px-6 py-4 font-bold text-on-surface">${m}</td>
            <td class="px-6 py-4 font-mono text-outline">${data.risk.toFixed(2)}</td>
            <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 ${maintenanceState ? 'bg-secondary shadow-[0_0_8px_#ffb3ae]' : (data.risk > CRITICAL_THRESHOLD ? 'bg-error shadow-[0_0_8px_#ff4c4c]' : 'bg-primary-container shadow-[0_0_8px_#ffd700]')}"></span>
                    <span class="${maintenanceState ? 'text-secondary' : (data.risk > CRITICAL_THRESHOLD ? 'text-error' : 'text-primary-container')}">${maintenanceState ? 'MAINTENANCE' : (data.risk > CRITICAL_THRESHOLD ? 'CRITICAL' : 'STABLE')}</span>
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
}

init();
