/**
 * SENTINEL 4 - Mission Control Frontend OS
 * Unified Data Binding & View Management
 */

const machines = ['M1_THERMAL_ENGINE', 'M2_HYDRAULIC_PUMP', 'M3_SERVO_ARRAY', 'M4_COOLING_FAN'];
const sensors = ['temperature', 'vibration', 'rpm', 'current'];

const baseValues = {
    'M1_THERMAL_ENGINE': { temperature: 80.5, vibration: 1.2, rpm: 1500, current: 3.1 },
    'M2_HYDRAULIC_PUMP': { temperature: 42.1, vibration: 0.4, rpm: 1200, current: 1.8 },
    'M3_SERVO_ARRAY': { temperature: 38.9, vibration: 0.1, rpm: 3200, current: 4.2 },
    'M4_COOLING_FAN': { temperature: 22.4, vibration: 0.8, rpm: 850, current: 0.9 }
};

let machineData = {};
let alerts = [];
let activeView = 'dashboard';
let selectedMachine = null;

// Initialization
function init() {
    machines.forEach(m => {
        machineData[m] = {
            id: m,
            metrics: { ...baseValues[m] },
            risk: 0.15, // Base risk
            lastUpdated: new Date()
        };
    });

    // Seed some initial instability in M1
    machineData['M1_THERMAL_ENGINE'].risk = 0.82;
    machineData['M1_THERMAL_ENGINE'].metrics.temperature = 92.4;
    alerts.push({
        id: Date.now(),
        machineId: 'M1_THERMAL_ENGINE',
        message: 'Thermal Spike Detected',
        level: 'CRITICAL',
        timestamp: new Date()
    });

    setupEventListeners();
    startSimulation();
    renderAll();
}

function setupEventListeners() {
    // Nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;
            if (viewId) switchView(viewId);
        });
    });
}

function switchView(viewId) {
    activeView = viewId;
    
    // UI Update
    document.querySelectorAll('.content-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.view === viewId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    renderAll();
}

// Data Handling
function startSimulation() {
    setInterval(() => {
        machines.forEach(m => {
            const data = machineData[m];
            
            // Random fluctuation
            sensors.forEach(s => {
                const noise = (Math.random() - 0.5) * (baseValues[m][s] * 0.02);
                data.metrics[s] = Math.max(0, data.metrics[s] + noise);
            });

            // Occasional risk spikes
            if (Math.random() > 0.98) {
                data.risk = Math.min(1.0, data.risk + 0.2);
                if (data.risk > 0.7) {
                    addAlert(m, "Predictive drift anomaly detected", "WARNING");
                }
            } else {
                data.risk = Math.max(0.1, data.risk - 0.01);
            }
        });

        renderAll();
    }, 2000);
}

function addAlert(machineId, message, level) {
    alerts.unshift({
        id: Date.now(),
        machineId,
        message,
        level,
        timestamp: new Date()
    });
    if (alerts.length > 5) alerts.pop();
}

// Rendering Logic
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
                    <p class="font-mono text-lg ${data.risk > 0.8 ? 'text-error' : 'text-on-background'} font-bold">${data.metrics.temperature.toFixed(1)}°C</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">VIB</p>
                    <p class="font-mono text-lg text-on-background font-bold">${data.metrics.vibration.toFixed(2)}</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">RPM</p>
                    <p class="font-mono text-lg text-on-background font-bold">${data.metrics.rpm.toFixed(0)}</p>
                </div>
                <div class="bg-surface-container-lowest p-3">
                    <p class="text-[9px] font-headline tracking-widest text-outline mb-1 uppercase">LOAD</p>
                    <p class="font-mono text-lg text-on-background font-bold">${data.metrics.current.toFixed(1)}A</p>
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
    heatmap.innerHTML = '';
    for (let i = 0; i < 36; i++) {
        const cell = document.createElement('div');
        const intensity = Math.random();
        if (intensity > 0.9) cell.className = 'bg-error animate-pulse';
        else if (intensity > 0.7) cell.className = 'bg-secondary/40';
        else cell.className = 'bg-surface-container-high hover:bg-primary-container/20 transition-colors';
        heatmap.appendChild(cell);
    }
}

function renderAlertFeed() {
    const feed = document.getElementById('dashboard-alert-feed');
    feed.innerHTML = '';
    alerts.forEach(a => {
        const aElem = document.createElement('div');
        aElem.className = 'p-3 bg-surface-container-low border border-outline-variant/30 flex justify-between items-center group cursor-pointer hover:bg-error hover:text-background transition-all';
        aElem.innerHTML = `
            <div>
                <p class="font-mono text-[9px] font-bold">${a.machineId}</p>
                <p class="font-mono text-[10px] uppercase">${a.message}</p>
            </div>
            <span class="material-symbols-outlined text-sm">arrow_forward</span>
        `;
        feed.appendChild(aElem);
    });
}

function renderDiagnostics() {
    const mId = selectedMachine || machines[0];
    const data = machineData[mId];

    document.getElementById('diag-machine-id').innerText = mId;
    document.getElementById('diag-case-ref').innerText = `CASE_REF: AX-${data.id.split('_')[0]}-${Math.floor(Math.random()*9000)+1000}`;
    
    const statusText = data.risk >= 0.8 ? 'CRITICAL_FAILURE_LIKELY' : (data.risk >= 0.6 ? 'WARNING_STRESS' : 'STABLE_NODE');
    document.getElementById('diag-status').innerText = `Status: ${statusText}`;
    document.getElementById('diag-status').className = `text-sm font-headline font-bold uppercase ${data.risk >= 0.8 ? 'text-error' : (data.risk >= 0.6 ? 'text-secondary' : 'text-primary-container')}`;

    // Header card styling
    const headerCard = document.getElementById('diag-header-card');
    headerCard.className = `bg-surface-container-low p-6 border-l-4 ${data.risk >= 0.8 ? 'border-error' : (data.risk >= 0.6 ? 'border-secondary' : 'border-primary-container')}`;

    // Logic Chain
    const narrative = document.getElementById('ai-narrative');
    if (data.risk >= 0.8) {
        narrative.innerHTML = `
            <span class="text-on-surface">Analysis:</span> Non-linear friction observed in ${mId} drive train. 
            <br/><br/>
            <span class="text-on-surface">Recommendation:</span> Immediate lubrication and bearing check. Risk of cascade failure is HIGH.
            <br/><br/>
            <span class="text-on-surface">Status:</span> Critical bias in temperature (${data.metrics.temperature.toFixed(1)}°C).
        `;
    } else {
        narrative.innerHTML = `
            <span class="text-on-surface">Analysis:</span> Waveform harmonics for ${mId} are within baseline 5% variance.
            <br/><br/>
            <span class="text-on-surface">Recommendation:</span> Continue scheduled monitoring. No manual intervention required.
        `;
    }

    // Update Pulse Chart
    const points = generateGraphPoints(data.risk * 2);
    document.getElementById('diag-pulse-line').setAttribute('points', points.split(' ').map((p, i) => {
        if (!p) return '';
        const [x, y] = p.split(',');
        return `${i*50},${y}`;
    }).join(' '));
}

function renderMaintenance() {
    const tbody = document.getElementById('maintenance-table-body');
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
    if (dispatch.options.length === 0) {
        machines.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = m;
            dispatch.appendChild(opt);
        });
    }

    renderTimeline();
}

function renderTimeline() {
    const container = document.getElementById('timeline-container');
    container.innerHTML = '<div class="absolute left-9 top-8 bottom-8 w-px bg-outline-variant/30"></div>';
    
    const events = [
        { title: 'CORE_SYNC', time: '12H_AGO', msg: 'System integrity handshake complete across all sectors.' },
        { title: 'THRESHOLD_UPDATE', time: '2D_AGO', msg: 'Updated Z-score drift sensitivities for Facility Alpha.' }
    ];

    events.forEach(ev => {
        const item = document.createElement('div');
        item.className = 'relative flex gap-6 mb-8';
        item.innerHTML = `
            <div class="z-10 w-6 h-6 bg-surface-container-highest border border-primary-container flex items-center justify-center">
                <div class="w-2 h-2 bg-primary-container"></div>
            </div>
            <div>
                <div class="flex items-center gap-3">
                    <span class="font-mono text-xs text-primary-container font-bold">${ev.title}</span>
                    <span class="font-mono text-[10px] text-outline bg-surface-container-high px-2 py-0.5">${ev.time}</span>
                </div>
                <p class="text-sm text-on-surface-variant font-body mt-1">${ev.msg}</p>
            </div>
        `;
        container.appendChild(item);
    });
}

// Ingest Auth Sequence (Visual Only)
let authProgress = 75;
setInterval(() => {
    authProgress = Math.min(100, authProgress + (Math.random() < 0.1 ? 1 : 0));
    if (authProgress === 100) authProgress = 75;
    const bar = document.getElementById('auth-progress');
    if (bar) bar.style.width = authProgress + '%';
}, 1000);

// Run
init();
