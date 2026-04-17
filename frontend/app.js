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
const MAX_HISTORY = 50;
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
            lastUpdated: new Date()
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
    
    // Attempt to connect to live simulation server (malendau-hackathon)
    connectToLiveStreams();
    
    // Fallback/Parallel simulation for UI consistency
    startLocalSimulation();
    
    renderAll();
}

function connectToLiveStreams() {
    machines.forEach(mId => {
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
    });
}

function updateMachineData(mId, reading) {
    if (!machineData[mId]) return;
    
    machineData[mId].metrics = { ...reading };
    machineData[mId].lastUpdated = new Date(reading.timestamp);

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
    calculateClientRisk(mId);
    
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'diagnostics' && selectedMachine === mId) {
        renderDiagnostics();
        updateForensicChart();
    }
}

function calculateClientRisk(mId) {
    const metrics = machineData[mId].metrics;
    const base = baseValues[mId];
    let risk = 0.1;
    
    if (metrics.temperature_C > base.temperature_C * 1.2) risk += 0.4;
    if (metrics.vibration_mm_s > base.vibration_mm_s * 2.0) risk += 0.4;

    const prevRisk = machineData[mId].risk;
    machineData[mId].risk = Math.min(1.0, risk);

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
}

function switchView(viewId) {
    activeView = viewId;
    document.querySelectorAll('.content-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    renderAll();
}

function startLocalSimulation() {
    // If SSE isn't working, this keeps the UI "alive"
    setInterval(() => {
        machines.forEach(m => {
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
    const mId = selectedMachine || machines[0];
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
}

init();
