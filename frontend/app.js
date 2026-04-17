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

// Initialization
function init() {
    machines.forEach(m => {
        machineData[m] = {
            id: m,
            metrics: { ...baseValues[m] },
            risk: 0.15,
            lastUpdated: new Date()
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
    
    // In a live environment, the risk would come from the backend.
    // Here we do a simple client-side heuristic for visual feedback.
    calculateClientRisk(mId);
    
    if (activeView === 'dashboard' || (activeView === 'diagnostics' && selectedMachine === mId)) {
        renderAll();
    }
}

function calculateClientRisk(mId) {
    const metrics = machineData[mId].metrics;
    const base = baseValues[mId];
    let risk = 0.1;
    
    if (metrics.temperature_C > base.temperature_C * 1.2) risk += 0.4;
    if (metrics.vibration_mm_s > base.vibration_mm_s * 2.0) risk += 0.4;
    
    machineData[mId].risk = Math.min(1.0, risk);
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
            renderAll();
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
                    <p class="font-mono text-lg ${data.risk > 0.8 ? 'text-error' : 'text-on-background'} font-bold">${data.metrics.temperature_C?.toFixed(1) || '--'}°C</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">VIB</p>
                    <p class="font-mono text-lg text-on-background font-bold">${data.metrics.vibration_mm_s?.toFixed(2) || '--'}</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">RPM</p>
                    <p class="font-mono text-lg text-on-background font-bold">${data.metrics.rpm?.toFixed(0) || '--'}</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">LOAD</p>
                    <p class="font-mono text-lg text-on-background font-bold">${data.metrics.current_A?.toFixed(1) || '--'}A</p>
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
    for (let i = 0; i < 36; i++) {
        const cell = document.createElement('div');
        const intensity = Math.random();
        cell.className = intensity > 0.9 ? 'bg-error animate-pulse' : (intensity > 0.7 ? 'bg-secondary/40' : 'bg-surface-container-high');
        heatmap.appendChild(cell);
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

    const points = generateGraphPoints(data.risk * 2);
    document.getElementById('diag-pulse-line').setAttribute('points', points.split(' ').map((p, i) => {
        if (!p) return '';
        const [x, y] = p.split(','); return `${i*50},${y}`;
    }).join(' '));
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
