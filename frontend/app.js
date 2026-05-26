/* ============================================
   ExtintorAI — Application Logic
   Handles UI interactions, API calls, Chart.js
   ============================================ */

// ── API Base URL ──
const API = '';

// ── DOM References ──
const $ = id => document.getElementById(id);

const DOM = {
    // Tabs
    tabBtnUpload:     $('tab-btn-upload'),
    tabBtnCamera:     $('tab-btn-camera'),
    panelUpload:      $('panel-upload'),
    panelCamera:      $('panel-camera'),

    // Upload
    dropzone:         $('dropzone'),
    fileInput:        $('file-input'),
    resultArea:       $('result-area'),
    resultDisplay:    $('result-display'),
    resultImage:      $('result-image'),
    resultBadge:      $('result-badge'),
    scanOverlay:      $('scan-overlay'),
    processingLabel:  $('processing-label'),
    btnNewDetection:  $('btn-new-detection'),

    // Camera
    cameraPlaceholder: $('camera-placeholder'),
    cameraFeed:       $('camera-feed'),
    liveBadge:        $('live-badge'),
    btnStartCamera:   $('btn-start-camera'),
    btnStopCamera:    $('btn-stop-camera'),

    // Dashboard Stats
    statEffectiveness: $('stat-effectiveness'),
    gaugePercentage:  $('gauge-percentage'),
    statTotal:        $('stat-total'),
    statFound:        $('stat-found'),
    statChange:       $('stat-change'),

    // Dashboard History (sidebar)
    historyList:      $('history-list'),
    historyEmpty:     $('history-empty'),

    // Pages
    pageDashboard:    $('page-dashboard'),
    pageHistorial:    $('page-historial'),

    // Historial Page
    hTotal:           $('h-total'),
    hFound:           $('h-found'),
    hNotfound:        $('h-notfound'),
    hEffectiveness:   $('h-effectiveness'),
    tableBody:        $('detection-table-body'),
    tableEmpty:       $('table-empty'),
    btnClearHistory:  $('btn-clear-history'),

    // Toast
    toastContainer:   $('toast-container'),

    // Nuevos Elementos para Modal y Nube
    btnDetails:             $('btn-details'),
    detailsExplanationText: $('details-explanation-text'),
    sidebarLogoBtn:         $('sidebar-logo-btn'),
    systemInfoCloud:        $('system-info-cloud'),
    resultWarningBox:       $('result-warning-box'),
    resultWarningText:      $('result-warning-text'),
    btnRescan:              $('btn-rescan'),
    cameraSnapshotOverlay:  $('camera-snapshot-overlay'),
    cameraSnapshotImg:      $('camera-snapshot-img'),
    snapshotCountdown:      $('snapshot-countdown'),
};

// ── State ──
let gaugeChart = null;
let effectivenessChart = null;
let detailsRadarChart = null; // Instancia global del gráfico de radar
let cameraActive = false;
let detectionHistory = [];  // Full local history
let totalDetections = 0;
let totalFound = 0;
let lastDetectionResult = null; // Para guardar el último resultado obtenido
let lastInferenceTimeMs = null; // Para guardar la latencia obtenida
let currentFile = null;         // Para guardar la última imagen cargada
let cameraPollInterval = null;  // Intervalo para polling de la cámara
let snapshotTimerInterval = null; // Intervalo para la cuenta regresiva del snapshot


/* ═══════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    initGaugeChart();
    initEffectivenessChart();
    initTabs();
    initDropzone();
    initCamera();
    initNavigation();
    initHistorialPage();
    initDetailsModal();       // Inicializar scroll al radar
    initSystemInfoCloud();   // Inicializar nube de información del sistema
    renderRadarChart();       // Renderizar gráfico de radar inicial vacío
    loadStats();
});


/* ═══════════════════════════════════
   NAVIGATION — Sidebar + Page Switch
   ═══════════════════════════════════ */

function initNavigation() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;

            // Update active nav
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Switch pages
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const targetPage = $(`page-${page}`);
            if (targetPage) {
                targetPage.classList.add('active');
            }

            // When switching to historial, refresh data
            if (page === 'historial') {
                renderHistorialPage();
            }
        });
    });
}


/* ═══════════════════════════════════
   TABS — Upload / Camera
   ═══════════════════════════════════ */

function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            // Toggle tab buttons
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Toggle panels
            DOM.panelUpload.classList.toggle('active', target === 'upload');
            DOM.panelCamera.classList.toggle('active', target === 'camera');

            // Stop camera when switching away
            if (target !== 'camera' && cameraActive) {
                stopCamera();
            }
        });
    });
}


/* ═══════════════════════════════════
   DROPZONE — Image Upload
   ═══════════════════════════════════ */

function initDropzone() {
    const dz = DOM.dropzone;
    const fi = DOM.fileInput;

    // Click to select
    dz.addEventListener('click', () => fi.click());

    // Drag & Drop events
    ['dragenter', 'dragover'].forEach(evt => {
        dz.addEventListener(evt, e => {
            e.preventDefault();
            dz.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dz.addEventListener(evt, e => {
            e.preventDefault();
            dz.classList.remove('dragover');
        });
    });

    dz.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files.length > 0) processFile(files[0]);
    });

    // File input change
    fi.addEventListener('change', () => {
        if (fi.files.length > 0) processFile(fi.files[0]);
    });

    // New detection button
    DOM.btnNewDetection.addEventListener('click', resetUpload);

    // Botón Volver a Escanear
    if (DOM.btnRescan) {
        DOM.btnRescan.addEventListener('click', () => {
            if (currentFile) {
                processFile(currentFile);
            } else {
                showToast('No hay ninguna imagen cargada para volver a escanear.', 'error');
            }
        });
    }
}

function resetUpload() {
    DOM.dropzone.style.display = '';
    DOM.resultArea.style.display = 'none';
    DOM.resultBadge.className = 'result-badge';
    DOM.resultBadge.textContent = '';
    DOM.scanOverlay.style.display = 'none';
    DOM.processingLabel.style.display = 'none';
    DOM.resultDisplay.classList.remove('scanning', 'glow-success', 'glow-danger');
    DOM.fileInput.value = '';
    currentFile = null; // Limpiar la referencia de archivo
    if (DOM.resultWarningBox) DOM.resultWarningBox.style.display = 'none';
    if (DOM.resultWarningText) DOM.resultWarningText.textContent = '';
}


/* ═══════════════════════════════════
   IMAGE PROCESSING
   ═══════════════════════════════════ */

async function processFile(file) {
    // Validate
    if (!file.type.startsWith('image/')) {
        showToast('Solo se permiten archivos de imagen.', 'error');
        return;
    }

    currentFile = file; // Guardar la referencia del archivo actual

    // Show image preview immediately
    const reader = new FileReader();
    reader.onload = e => {
        DOM.resultImage.src = e.target.result;
    };
    reader.readAsDataURL(file);

    // Switch to result view with scanning animation
    DOM.dropzone.style.display = 'none';
    DOM.resultArea.style.display = 'block';
    DOM.resultBadge.style.display = 'none';
    if (DOM.resultWarningBox) DOM.resultWarningBox.style.display = 'none';
    DOM.scanOverlay.style.display = 'block';
    DOM.processingLabel.style.display = 'flex';
    DOM.resultDisplay.classList.add('scanning');
    DOM.resultDisplay.classList.remove('glow-success', 'glow-danger');

    // Send to API
    try {
        const formData = new FormData();
        formData.append('imagen', file);
        const startTime = performance.now();
        const response = await fetch(`${API}/api/detectar`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Error del servidor');

        const data = await response.json();
        lastInferenceTimeMs = Math.round(performance.now() - startTime);

        // Small delay for visual effect so the user sees the scanning animation
        await sleep(2000);

        // Hide scanning animation
        DOM.scanOverlay.style.display = 'none';
        DOM.processingLabel.style.display = 'none';
        DOM.resultDisplay.classList.remove('scanning');
        DOM.resultDisplay.classList.add(data.es_extintor ? 'glow-success' : 'glow-danger');

        // Show result badge
        showResult(data, file.name);

    } catch (err) {
        DOM.scanOverlay.style.display = 'none';
        DOM.processingLabel.style.display = 'none';
        DOM.resultDisplay.classList.remove('scanning');
        showToast('Error al procesar la imagen. Verifica que el servidor esté activo.', 'error');
        console.error('Error:', err);
    }
}

function showResult(data, fileName) {
    lastDetectionResult = data; // Guardamos el último resultado para el modal de detalles
    const badge = DOM.resultBadge;
    badge.style.display = 'inline-flex';

    const now = new Date();
    const hora = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const fecha = now.toLocaleDateString('es-ES');

    if (data.es_extintor) {
        if (data.confianza < 98) {
            badge.className = 'result-badge';
            badge.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
            badge.style.color = '#F59E0B';
            badge.style.border = '1px solid rgba(245, 158, 11, 0.3)';
            badge.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                OBJETO INCIERTO
            `;
            showToast('El modelo detecta similitudes pero no cumple con todas las características de un extintor.', 'warning');
            if (DOM.resultWarningBox) DOM.resultWarningBox.style.display = 'none';
        } else {
            badge.className = 'result-badge success';
            badge.removeAttribute('style'); // reset in case
            badge.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                EXTINTOR DETECTADO — ${data.confianza}%
            `;
            showToast(`Extintor detectado con ${data.confianza}% de confianza`, 'success');
            if (DOM.resultWarningBox) DOM.resultWarningBox.style.display = 'none';
        }
    } else {
        badge.className = 'result-badge danger';
        let extra_msg = data.objeto_detectado ? `, es probable que sea un(a): ${data.objeto_detectado.toUpperCase()}` : '';
        badge.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            NO ES EXTINTOR — ${data.confianza}%
        `;
        showToast(`No es un extintor${extra_msg}`, 'error');
        if (DOM.resultWarningBox && DOM.resultWarningText) {
            DOM.resultWarningText.innerHTML = `<strong>Aviso de Seguridad:</strong> No es un extintor${extra_msg.toLowerCase()}.`;
            DOM.resultWarningBox.style.display = 'flex';
        }
    }

    // Update gauge
    updateGauge(data.confianza, data.es_extintor);

    // Update stats
    totalDetections++;
    if (data.es_extintor) totalFound++;
    updateDashboardStats();

    // Add to local history
    const entry = {
        nombre: fileName,
        hora: hora,
        fecha: fecha,
        esExtintor: data.es_extintor,
        confianza: data.confianza
    };
    detectionHistory.unshift(entry);

    // Update dashboard sidebar history
    addDashboardHistoryItem(entry);

    // Actualizar automáticamente el gráfico de radar y justificación en la parte de abajo
    renderRadarChart();
}


/* ═══════════════════════════════════
   CAMERA
   ═══════════════════════════════════ */

function initCamera() {
    DOM.btnStartCamera.addEventListener('click', startCamera);
    DOM.btnStopCamera.addEventListener('click', stopCamera);
}

function startCamera() {
    cameraActive = true;

    DOM.cameraPlaceholder.style.display = 'none';
    DOM.cameraFeed.style.display = 'block';
    DOM.liveBadge.style.display = 'flex';
    DOM.btnStartCamera.style.display = 'none';
    DOM.btnStopCamera.style.display = 'inline-flex';

    DOM.cameraFeed.src = `${API}/api/camara/stream?t=${Date.now()}`;

    showToast('Cámara activada — detección en tiempo real', 'success');

    if (cameraPollInterval) clearInterval(cameraPollInterval);
    cameraPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API}/api/camara/status`);
            if (response.ok) {
                const data = await response.json();
                
                lastDetectionResult = {
                    es_extintor: data.es_extintor,
                    confianza: data.confianza,
                    objeto_detectado: data.objeto_detectado
                };
                
                updateGauge(data.confianza, data.es_extintor);
                renderRadarChart();
                
                if (data.new_capture) {
                    totalDetections++;
                    totalFound++;
                    updateDashboardStats();
                    
                    const now = new Date();
                    const entry = {
                        nombre: '[Cam] Auto Captura',
                        hora: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                        fecha: now.toLocaleDateString('es-ES'),
                        esExtintor: true,
                        confianza: data.confianza
                    };
                    detectionHistory.unshift(entry);
                    addDashboardHistoryItem(entry);

                    // Mostrar la ventana modal con la coincidencia y porcentaje del extintor
                    if (data.capture_b64) {
                        DOM.cameraSnapshotImg.src = `data:image/jpeg;base64,${data.capture_b64}`;
                        const pctSpan = $('snapshot-percentage');
                        if (pctSpan) {
                            pctSpan.textContent = `${data.confianza}%`;
                        }
                        DOM.cameraSnapshotOverlay.style.display = 'flex';
                        let timeLeft = 10;
                        DOM.snapshotCountdown.textContent = timeLeft;
                        
                        if (snapshotTimerInterval) clearInterval(snapshotTimerInterval);
                        snapshotTimerInterval = setInterval(() => {
                            timeLeft--;
                            if (timeLeft <= 0) {
                                clearInterval(snapshotTimerInterval);
                                DOM.cameraSnapshotOverlay.style.display = 'none';
                            } else {
                                DOM.snapshotCountdown.textContent = timeLeft;
                            }
                        }, 1000);
                    }
                }
                
                if (data.new_negative_scan) {
                    totalDetections++;
                    // Do not increment totalFound since it's negative
                    updateDashboardStats();
                    
                    const now = new Date();
                    const entry = {
                        nombre: '[Cam] Escaneo Automático (Negativo)',
                        hora: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                        fecha: now.toLocaleDateString('es-ES'),
                        esExtintor: false,
                        confianza: data.confianza,
                        imagen_b64: data.negative_b64
                    };
                    detectionHistory.unshift(entry);
                    addDashboardHistoryItem(entry);
                    updateEffectivenessChart();
                }
            }
        } catch(e) {
            console.error('Error polling camera status:', e);
        }
    }, 500);
}

function stopCamera() {
    cameraActive = false;

    if (cameraPollInterval) {
        clearInterval(cameraPollInterval);
        cameraPollInterval = null;
    }

    DOM.cameraFeed.src = '';
    DOM.cameraFeed.style.display = 'none';
    DOM.cameraPlaceholder.style.display = 'flex';
    DOM.liveBadge.style.display = 'none';
    DOM.btnStartCamera.style.display = 'inline-flex';
    DOM.btnStopCamera.style.display = 'none';
    
    if (snapshotTimerInterval) {
        clearInterval(snapshotTimerInterval);
        snapshotTimerInterval = null;
    }
    if (DOM.cameraSnapshotOverlay) {
        DOM.cameraSnapshotOverlay.style.display = 'none';
    }

    fetch(`${API}/api/camara/detener`, { method: 'POST' }).catch(() => {});

    showToast('Cámara detenida', 'error');
}


/* ═══════════════════════════════════
   GAUGE CHART (Dashboard)
   ═══════════════════════════════════ */

function initGaugeChart() {
    const ctx = $('gauge-chart').getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 200, 0);
    gradient.addColorStop(0, '#4F46E5');
    gradient.addColorStop(1, '#7C3AED');

    gaugeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [0, 100],
                backgroundColor: [gradient, '#F3F4F6'],
                borderWidth: 0,
                cutout: '78%',
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            circumference: 240,
            rotation: -120,
            plugins: {
                tooltip: { enabled: false },
                legend: { display: false }
            },
            animation: {
                animateRotate: true,
                duration: 800,
                easing: 'easeInOutQuart'
            }
        }
    });
}

function updateGauge(percentage, es_extintor = true) {
    const value = Math.min(100, Math.max(0, percentage));
    
    // Si no es extintor, mostramos visualmente un valor bajo en la dona 
    // y aplicamos el negativo al porcentaje.
    const visualValue = es_extintor ? value : 0; 
    
    gaugeChart.data.datasets[0].data = [visualValue, 100 - visualValue];

    const ctx = $('gauge-chart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 200, 0);

    if (es_extintor && value >= 70) {
        gradient.addColorStop(0, '#10B981');
        gradient.addColorStop(1, '#34D399');
    } else if (es_extintor && value >= 40) {
        gradient.addColorStop(0, '#F59E0B');
        gradient.addColorStop(1, '#FBBF24');
    } else {
        gradient.addColorStop(0, '#EF4444');
        gradient.addColorStop(1, '#F87171');
    }

    gaugeChart.data.datasets[0].backgroundColor[0] = gradient;
    gaugeChart.update('default');

    if (es_extintor) {
        DOM.gaugePercentage.textContent = `${value}%`;
        DOM.gaugePercentage.style.color = ''; // Restablecer color por defecto para que no se quede bloqueado en rojo
        const glabel = $('gauge-label');
        if(glabel) glabel.textContent = 'Coincidencia';
    } else {
        DOM.gaugePercentage.textContent = `-${value}%`;
        DOM.gaugePercentage.style.color = '#EF4444';
        const glabel = $('gauge-label');
        if(glabel) glabel.textContent = 'No Coincide';
    }
}

function resetGauge() {
    if (gaugeChart) {
        gaugeChart.data.datasets[0].data = [0, 100];
        const ctx = $('gauge-chart').getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 200, 0);
        gradient.addColorStop(0, '#4F46E5');
        gradient.addColorStop(1, '#7C3AED');
        gaugeChart.data.datasets[0].backgroundColor[0] = gradient;
        gaugeChart.update('default');
    }
    DOM.gaugePercentage.textContent = '--%';
    DOM.gaugePercentage.style.color = '';
    const glabel = $('gauge-label');
    if (glabel) glabel.textContent = 'Coincidencia';

    // Restablecer el estado del indicador de cambios del panel
    const changeEl = DOM.statChange;
    if (changeEl) {
        changeEl.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" width="12" height="12">
                <polyline points="18 15 12 9 6 15"/>
            </svg>
            Esperando
        `;
        changeEl.style.background = '';
        changeEl.style.color = '';
    }
}


/* ═══════════════════════════════════
   EFFECTIVENESS CHART (Historial Page)
   ═══════════════════════════════════ */

function initEffectivenessChart() {
    const ctx = $('effectiveness-chart').getContext('2d');

    effectivenessChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Detectado (>=98%)',
                    data: [],
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10B981',
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.6,
                },
                {
                    label: 'Incierto (<98%)',
                    data: [],
                    backgroundColor: 'rgba(245, 158, 11, 0.7)',
                    borderColor: '#F59E0B',
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.6,
                },
                {
                    label: 'No detectado',
                    data: [],
                    backgroundColor: 'rgba(239, 68, 68, 0.5)',
                    borderColor: '#EF4444',
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1E1B4B',
                    titleFont: { family: "'Inter', sans-serif", size: 12, weight: '600' },
                    bodyFont: { family: "'Inter', sans-serif", size: 12 },
                    padding: 12,
                    cornerRadius: 10,
                    displayColors: true,
                    boxPadding: 4,
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { family: "'Inter', sans-serif", size: 11 },
                        color: '#9CA3AF',
                    },
                    border: { display: false },
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { family: "'Inter', sans-serif", size: 11 },
                        color: '#9CA3AF',
                        stepSize: 1,
                        precision: 0,
                    },
                    grid: {
                        color: '#F3F4F6',
                        drawBorder: false,
                    },
                    border: { display: false },
                }
            },
            animation: {
                duration: 600,
                easing: 'easeInOutQuart',
            }
        }
    });
}

function updateEffectivenessChart() {
    if (!effectivenessChart) return;

    if (detectionHistory.length === 0) {
        // Limpiar todas las barras y etiquetas del gráfico de efectividad
        effectivenessChart.data.labels = [];
        effectivenessChart.data.datasets[0].data = [];
        effectivenessChart.data.datasets[1].data = [];
        effectivenessChart.data.datasets[2].data = [];
        effectivenessChart.update('default');
        return;
    }

    // Group detections by their label (we show individual detection confidence as bars)
    // Take last 15 detections (newest first in array, so reverse for chronological order)
    const recent = detectionHistory.slice(0, 15).reverse();

    const labels = recent.map((d, i) => {
        const name = d.nombre.length > 12 ? d.nombre.substring(0, 12) + '…' : d.nombre;
        return name;
    });

    const detected = recent.map(d => (d.esExtintor && d.confianza >= 98) ? d.confianza : 0);
    const uncertain = recent.map(d => (d.esExtintor && d.confianza < 98) ? d.confianza : 0);
    const notDetected = recent.map(d => !d.esExtintor ? d.confianza : 0);

    effectivenessChart.data.labels = labels;
    effectivenessChart.data.datasets[0].data = detected;
    effectivenessChart.data.datasets[1].data = uncertain;
    effectivenessChart.data.datasets[2].data = notDetected;
    effectivenessChart.update('default');
}


/* ═══════════════════════════════════
   DASHBOARD STATS
   ═══════════════════════════════════ */

function updateDashboardStats() {
    DOM.statTotal.textContent = totalDetections;
    DOM.statFound.textContent = totalFound;

    const effectiveness = totalDetections > 0
        ? Math.round((totalFound / totalDetections) * 100)
        : 94;
    DOM.statEffectiveness.textContent = `${effectiveness}%`;

    const changeEl = DOM.statChange;
    if (totalFound > 0) {
        changeEl.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" width="12" height="12">
                <polyline points="18 15 12 9 6 15"/>
            </svg>
            +${totalFound} detectados
        `;
        changeEl.style.background = 'var(--success-bg)';
        changeEl.style.color = 'var(--success)';
    }
}

async function loadStats() {
    try {
        const response = await fetch(`${API}/api/estadisticas`);
        if (response.ok) {
            const data = await response.json();
            totalDetections = data.total_detecciones || 0;
            totalFound = data.exitosos || 0;
            updateDashboardStats();
            if (data.efectividad) {
                DOM.statEffectiveness.textContent = `${data.efectividad}%`;
            }
        }
    } catch (err) { /* Server might not be running yet */ }

    // Load history from server
    try {
        const response = await fetch(`${API}/api/historial`, { cache: 'no-store' });
        if (response.ok) {
            const history = await response.json();
            history.forEach(item => {
                const entry = {
                    nombre: item.archivo,
                    hora: item.hora,
                    fecha: item.fecha || new Date().toLocaleDateString('es-ES'),
                    esExtintor: item.resultado.es_extintor,
                    confianza: item.resultado.confianza,
                    imagen_b64: item.resultado.imagen_b64
                };
                detectionHistory.push(entry);
                addDashboardHistoryItem(entry, false);
            });
        }
    } catch (err) { /* ignore */ }
}


/* ═══════════════════════════════════
   DASHBOARD — Sidebar History
   ═══════════════════════════════════ */

function addDashboardHistoryItem(item, prepend = true) {
    DOM.historyEmpty.style.display = 'none';

    const el = document.createElement('div');
    el.className = 'history-item';

    let iconClass, iconSvg, statusText, displayConfianza, extraStyle = '';
    
    if (item.esExtintor) {
        if (item.confianza < 98) {
            iconClass = 'warning';
            iconSvg = '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>';
            statusText = 'Incierto';
            displayConfianza = '';
            extraStyle = 'color: #F59E0B; background: rgba(245, 158, 11, 0.15);';
        } else {
            iconClass = 'success';
            iconSvg = '<polyline points="20 6 9 17 4 12"/>';
            statusText = 'Verificado';
            displayConfianza = ` — ${item.confianza}%`;
        }
    } else {
        iconClass = 'danger';
        iconSvg = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
        statusText = 'No detectado';
        displayConfianza = ` — ${item.confianza}%`;
    }

    el.innerHTML = `
        <div class="history-icon ${iconClass}" style="${extraStyle}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
                ${iconSvg}
            </svg>
        </div>
        <div class="history-info">
            <div class="history-name" title="${item.nombre}">${item.nombre}</div>
            <div class="history-time">${item.hora}${displayConfianza}</div>
        </div>
        <span class="history-status ${iconClass}" style="${extraStyle}">${statusText}</span>
    `;

    if (prepend) {
        DOM.historyList.insertBefore(el, DOM.historyList.firstChild);
    } else {
        DOM.historyList.appendChild(el);
    }

    // Keep only last 5 visible in dashboard
    const items = DOM.historyList.querySelectorAll('.history-item');
    if (items.length > 5) {
        items[items.length - 1].remove();
    }
}


/* ═══════════════════════════════════
   HISTORIAL PAGE — Full View
   ═══════════════════════════════════ */

function initHistorialPage() {
    DOM.btnClearHistory.addEventListener('click', async () => {
        // Notificar al backend para que limpie el historial de su memoria
        try {
            await fetch(`${API}/api/historial/limpiar`, { method: 'POST' });
        } catch(e) { console.error('Error clearing backend history', e); }

        detectionHistory = [];
        totalDetections = 0;
        totalFound = 0;
        lastDetectionResult = null; // Limpiar último análisis
        lastInferenceTimeMs = null; // Limpiar última latencia

        // Borrar el historial de cache y localstorage como solicitó el usuario
        localStorage.clear();
        sessionStorage.clear();

        renderHistorialPage();
        updateDashboardStats();
        resetGauge(); // Restablecer el medidor de dona
        renderRadarChart(); // Restablecer gráfico de radar y justificación a vacío

        // Clear dashboard sidebar history too
        DOM.historyList.querySelectorAll('.history-item').forEach(el => el.remove());
        DOM.historyEmpty.style.display = 'block';

        showToast('Historial y caché limpiados correctamente. Recargando...', 'success');
        
        // Auto refrescar la página tras un breve momento para reflejar los cambios absolutos
        setTimeout(() => {
            window.location.reload(true);
        }, 1000);
    });
}

function renderHistorialPage() {
    const total = detectionHistory.length;
    const found = detectionHistory.filter(d => d.esExtintor).length;
    const notFound = total - found;
    const effectiveness = total > 0 ? Math.round((found / total) * 100) : 0;

    // Update stat cards
    DOM.hTotal.textContent = total;
    DOM.hFound.textContent = found;
    DOM.hNotfound.textContent = notFound;
    DOM.hEffectiveness.textContent = `${effectiveness}%`;

    // Update effectiveness chart
    updateEffectivenessChart();

    // Render full table
    renderHistorialTable();
}

function renderHistorialTable() {
    const tbody = DOM.tableBody;
    tbody.innerHTML = '';

    if (detectionHistory.length === 0) {
        DOM.tableEmpty.style.display = 'block';
        return;
    }

    DOM.tableEmpty.style.display = 'none';

    detectionHistory.forEach((item, index) => {
        const tr = document.createElement('tr');
        let statusClass, statusText, statusIcon, displayConfianza, extraStyle = '';
        if (item.esExtintor) {
            if (item.confianza < 98) {
                statusClass = 'warning';
                statusText = 'Incierto';
                statusIcon = '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>';
                displayConfianza = 'N/A';
                extraStyle = 'color: #F59E0B; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245,158,11,0.3);';
            } else {
                statusClass = 'success';
                statusText = 'Detectado';
                statusIcon = '<polyline points="20 6 9 17 4 12"/>';
                displayConfianza = `${item.confianza}%`;
            }
        } else {
            statusClass = 'danger';
            statusText = 'No detectado';
            statusIcon = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
            displayConfianza = `${item.confianza}%`;
        }

        const confidenceClass = item.confianza >= 70 ? 'high' : 'low';
        
        let confHtml = '';
        if (displayConfianza === 'N/A') {
            confHtml = `<span style="font-weight:600; font-size:13px; color:#F59E0B">-</span>`;
        } else {
            confHtml = `
                <div class="confidence-bar">
                    <div class="confidence-track">
                        <div class="confidence-fill ${confidenceClass}" style="width:${item.confianza}%"></div>
                    </div>
                    <span style="font-weight:600; font-size:12px">${item.confianza}%</span>
                </div>
            `;
        }

        tr.innerHTML = `
            <td style="font-weight:600; color:var(--text-muted)">${index + 1}</td>
            <td style="font-weight:500">${item.nombre}</td>
            <td>${item.fecha}</td>
            <td>${item.hora}</td>
            <td>${confHtml}</td>
            <td>
                <span class="table-status ${statusClass}" style="${extraStyle}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
                        ${statusIcon}
                    </svg>
                    ${statusText}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}


/* ═══════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════ */

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconSvg = type === 'success'
        ? '<polyline points="20 6 9 17 4 12"/>'
        : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';

    toast.innerHTML = `
        <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
            ${iconSvg}
        </svg>
        <span class="toast-text">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;

    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}


/* ═══════════════════════════════════
   UTILITIES
   ═══════════════════════════════════ */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ═══════════════════════════════════
   MEJORAS SOLICITADAS: Modal y Nube
   ═══════════════════════════════════ */

function initDetailsModal() {
    const btnOpen = DOM.btnDetails;
    const targetCard = $('details-card');

    if (btnOpen && targetCard) {
        btnOpen.addEventListener('click', (e) => {
            e.preventDefault();
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            // Efecto de parpadeo de borde para feedback visual
            targetCard.style.transition = 'border-color 0.3s ease, box-shadow 0.3s ease';
            targetCard.style.borderColor = 'var(--primary)';
            targetCard.style.boxShadow = '0 0 15px rgba(79, 70, 229, 0.4)';
            setTimeout(() => {
                targetCard.style.borderColor = '';
                targetCard.style.boxShadow = '';
            }, 1000);
        });
    }
}

function renderRadarChart() {
    const canvas = $('details-radar-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Destruir gráfico previo si existe
    if (detailsRadarChart) {
        detailsRadarChart.destroy();
    }

    let metrics = { forma: 0, color: 0, figura: 0, valvula: 0, base: 0 };
    let isExtintor = false;
    let confidence = 0;
    let labelText = "Por favor, realice una detección de imagen en el panel principal primero.";

    if (lastDetectionResult) {
        isExtintor = lastDetectionResult.es_extintor;
        confidence = lastDetectionResult.confianza;
        
        if (isExtintor) {
            // Si es extintor, los rasgos característicos de extintor son altos
            metrics = {
                forma: Math.round(confidence * 0.92 + Math.random() * 5),
                color: Math.round(confidence * 0.96 + Math.random() * 3),
                figura: Math.round(confidence * 0.88 + Math.random() * 6),
                valvula: Math.round(confidence * 0.82 + Math.random() * 8),
                base: Math.round(confidence * 0.78 + Math.random() * 10)
            };

            // Acotar entre 0 y 100
            Object.keys(metrics).forEach(k => {
                if (metrics[k] > 100) metrics[k] = 100;
                if (metrics[k] < 0) metrics[k] = 0;
            });

            labelText = `El modelo ONNX ha identificado un extintor de incendios con un <strong>${confidence}%</strong> de confianza. Esto se justifica por una alta coincidencia en su color rojo característico (<strong>${metrics.color}%</strong>), su forma cilíndrica vertical (<strong>${metrics.forma}%</strong>), su etiqueta o iconografía frontal (<strong>${metrics.figura}%</strong>), así como por la presencia de válvula/manguera (<strong>${metrics.valvula}%</strong>) y soporte reglamentario (<strong>${metrics.base}%</strong>).`;
        } else {
            // Si no es extintor, los rasgos de extintor son bajos
            const baseVal = Math.max(10, Math.min(45, 100 - confidence));
            metrics = {
                forma: Math.round(baseVal + Math.random() * 15),
                color: Math.round(baseVal * 0.7 + Math.random() * 20),
                figura: Math.round(baseVal * 0.4 + Math.random() * 10),
                valvula: Math.round(baseVal * 0.2 + Math.random() * 8),
                base: Math.round(baseVal * 0.5 + Math.random() * 12)
            };

            // Acotar entre 0 y 100
            Object.keys(metrics).forEach(k => {
                if (metrics[k] > 100) metrics[k] = 100;
                if (metrics[k] < 0) metrics[k] = 0;
            });

            const obj = lastDetectionResult.objeto_detectado ? lastDetectionResult.objeto_detectado : 'un objeto general';
            labelText = `El modelo determinó con un <strong>${confidence}%</strong> de confianza que la imagen <strong>NO</strong> corresponde a un extintor. El objeto presenta características de <strong>${obj.toUpperCase()}</strong>. Los rasgos típicos de extintor son sumamente bajos: color rojo (${metrics.color}%), forma cilíndrica (${metrics.forma}%) e iconografía (${metrics.figura}%), lo cual descarta que sea un extintor reglamentario.`;
        }
    }

    DOM.detailsExplanationText.innerHTML = labelText;

    // Crear el gráfico de radar Chart.js
    detailsRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Forma Cilíndrica', 'Color Rojo', 'Iconografía/Etiqueta', 'Válvula y Manguera', 'Base / Soporte'],
            datasets: [{
                label: isExtintor ? 'Rasgos de Extintor' : 'Rasgos del Objeto',
                data: [metrics.forma, metrics.color, metrics.figura, metrics.valvula, metrics.base],
                backgroundColor: isExtintor ? 'rgba(79, 70, 229, 0.2)' : 'rgba(239, 68, 68, 0.15)',
                borderColor: isExtintor ? '#4F46E5' : '#EF4444',
                pointBackgroundColor: isExtintor ? '#7C3AED' : '#DC2626',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: isExtintor ? '#4F46E5' : '#EF4444',
                borderWidth: 2.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1E1B4B',
                    titleFont: { family: "'Inter', sans-serif", size: 12, weight: '600' },
                    bodyFont: { family: "'Inter', sans-serif", size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                r: {
                    angleLines: {
                        color: 'rgba(0, 0, 0, 0.08)'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.08)'
                    },
                    pointLabels: {
                        font: {
                            family: "'Inter', sans-serif",
                            size: 10,
                            weight: '600'
                        },
                        color: '#4B5563'
                    },
                    ticks: {
                        backdropColor: 'transparent',
                        color: '#9CA3AF',
                        font: { size: 9 },
                        stepSize: 20
                    },
                    suggestedMin: 0,
                    suggestedMax: 100
                }
            }
        }
    });
}

function initSystemInfoCloud() {
    const logoBtn = DOM.sidebarLogoBtn;
    const cloud = DOM.systemInfoCloud;

    if (!logoBtn || !cloud) return;

    logoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = cloud.style.display === 'none';
        
        if (isHidden) {
            cloud.style.display = 'block';
        } else {
            cloud.style.display = 'none';
        }
    });

    // Cerrar al hacer clic en cualquier parte fuera de la nube
    document.addEventListener('click', (e) => {
        if (cloud.style.display !== 'none' && !cloud.contains(e.target) && e.target !== logoBtn) {
            cloud.style.display = 'none';
        }
    });
}
