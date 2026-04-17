// =================================================================
// Affix-OG · app.js — Advanced Full-Stack Frontend Logic v1.1.0
// =================================================================

const socket = io();

// ─── State ──────────────────────────────────────────────────────────
let dataBuffer = []; // Holds last 80 data points for PDF & AI
let isAuth = localStorage.getItem('affix_auth') === 'true';
const AUTH_CREDS = { id: 'abcd', pass: 'abcd1234' };

// ─── DOM References ─────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const navLinks = document.querySelectorAll('.nav-link');
const views = document.querySelectorAll('.view');
const topbarTitle = document.getElementById('topbarTitle');
const topbarTime = document.getElementById('topbarTime');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsClose = document.getElementById('settingsClose');
const connectionBadge = document.getElementById('connectionBadge');

// Security
const securityModal = document.getElementById('securityModal');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

// Dashboard
const ecgCanvas = document.getElementById('ecgCanvas');
const ecgCtx = ecgCanvas ? ecgCanvas.getContext('2d') : null;
const generatePdfBtn = document.getElementById('generatePdfBtn');

// AI
const aiDropzone = document.getElementById('aiDropzone');
const fileInput = document.getElementById('fileInput');
const analyzeLiveBtn = document.getElementById('analyzeLiveBtn');
const aiAnalysisContent = document.getElementById('aiAnalysisContent');

// Status
const statusLogList = document.getElementById('statusLogList');
const logEmpty = document.getElementById('logEmpty');


// ═══════════════════════════════════════════════════════════════════
// 1. NAVIGATION & VIEW SYSTEM
// ═══════════════════════════════════════════════════════════════════
function switchView(viewName) {
  // Security Gateway Check for Dashboard
  if (viewName === 'dashboard' && !isAuth) {
    securityModal.classList.add('active');
    return; // Don't switch yet
  }

  navLinks.forEach(link => link.classList.toggle('active', link.dataset.view === viewName));
  views.forEach(view => view.classList.toggle('active', view.id === `view-${viewName}`));
  
  const titles = {
    'home': 'Home', 'dashboard': 'Dashboard', 'ai-suggestions': 'AI Suggestions',
    'status-updates': 'Status Updates', 'patient-history': 'Patient History', 'digital-twin': 'Digital Twin'
  };
  topbarTitle.textContent = titles[viewName] || viewName;

  // Close sidebar on mobile after navigation
  if (window.innerWidth <= 768) sidebar.classList.remove('open');
}

navLinks.forEach(link => link.addEventListener('click', (e) => {
  e.preventDefault();
  switchView(link.dataset.view);
}));

// Hero buttons / inline view triggers
document.querySelectorAll('[data-view]').forEach(el => {
  if (!el.classList.contains('nav-link')) {
    el.addEventListener('click', (e) => { e.preventDefault(); switchView(el.dataset.view); });
  }
});

// UI Toggles
sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
settingsBtn.addEventListener('click', () => settingsPanel.classList.add('open'));
settingsClose.addEventListener('click', () => settingsPanel.classList.remove('open'));

// Close settings on outside click
document.addEventListener('click', (e) => {
  if (settingsPanel.classList.contains('open') && !settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
    settingsPanel.classList.remove('open');
  }
});


// ═══════════════════════════════════════════════════════════════════
// 2. SECURITY GATEWAY
// ═══════════════════════════════════════════════════════════════════
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('loginId').value;
  const pass = document.getElementById('loginPass').value;

  if (id === AUTH_CREDS.id && pass === AUTH_CREDS.pass) {
    isAuth = true;
    localStorage.setItem('affix_auth', 'true');
    securityModal.classList.remove('active');
    switchView('dashboard'); // Proceed to dashboard on success
  } else {
    loginError.classList.add('show');
    setTimeout(() => loginError.classList.remove('show'), 3000);
  }
});


// ═══════════════════════════════════════════════════════════════════
// 3. REAL-TIME DATA & ECG CANVAS RENDERING
// ═══════════════════════════════════════════════════════════════════
socket.on('bio:data', (data) => {
  window.__latestBioData = data;
  
  // Buffer logic (Keep last 80 points for AI and PDF)
  dataBuffer.push(data);
  if (dataBuffer.length > 80) dataBuffer.shift();

  // Update Dashboard Stats only if dashboard is active
  const dashView = document.getElementById('view-dashboard');
  if (dashView && dashView.classList.contains('active')) {
    document.getElementById('statHR').innerHTML = `${data.heart_rate}<span>BPM</span>`;
    document.getElementById('statSpO2').innerHTML = `${data.spo2}<span>%</span>`;
    document.getElementById('statTemp').innerHTML = `${data.body_temp}<span>°C</span>`;
    document.getElementById('statResp').innerHTML = `${data.respiratory_sound}<span>dB</span>`;
  }
});

// High-Performance ECG Canvas Renderer
let ecgHistory = new Array(200).fill(0);
let animationFrameId;

function drawECG() {
  if (!ecgCtx || !ecgCanvas) return;
  
  const parent = ecgCanvas.parentElement;
  if (!parent) return;

  // Handle High-DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = parent.getBoundingClientRect();
  
  ecgCanvas.width = rect.width * dpr;
  ecgCanvas.height = rect.height * dpr;
  ecgCanvas.style.width = `${rect.width}px`;
  ecgCanvas.style.height = `${rect.height}px`;
  ecgCtx.scale(dpr, dpr);

  const latest = window.__latestBioData;
  if (latest) {
    ecgHistory.push(latest.ecg_val);
    if (ecgHistory.length > 200) ecgHistory.shift();
  }

  ecgCtx.clearRect(0, 0, rect.width, rect.height);
  
  // Draw Grid
  ecgCtx.strokeStyle = 'rgba(0, 242, 255, 0.05)';
  ecgCtx.lineWidth = 1;
  for (let i = 0; i < rect.width; i += 20) {
    ecgCtx.beginPath(); ecgCtx.moveTo(i, 0); ecgCtx.lineTo(i, rect.height); ecgCtx.stroke();
  }
  for (let i = 0; i < rect.height; i += 20) {
    ecgCtx.beginPath(); ecgCtx.moveTo(0, i); ecgCtx.lineTo(rect.width, i); ecgCtx.stroke();
  }

  // Draw ECG Line
  ecgCtx.beginPath();
  ecgCtx.strokeStyle = '#00f2ff';
  ecgCtx.lineWidth = 2;
  ecgCtx.shadowBlur = 8;
  ecgCtx.shadowColor = '#00f2ff';
  ecgCtx.lineJoin = 'round';

  const stepX = rect.width / 200;
  const midY = rect.height / 2;
  const amplitude = (rect.height / 2) * 0.8;

  for (let i = 0; i < ecgHistory.length; i++) {
    const x = i * stepX;
    const y = midY - (ecgHistory[i] * amplitude);
    if (i === 0) ecgCtx.moveTo(x, y);
    else ecgCtx.lineTo(x, y);
  }
  ecgCtx.stroke();
  ecgCtx.shadowBlur = 0; // Reset shadow

  animationFrameId = requestAnimationFrame(drawECG);
}


// ═══════════════════════════════════════════════════════════════════
// 4. PDF HOSPITAL REPORT (jsPDF + html2canvas)
// ═══════════════════════════════════════════════════════════════════
generatePdfBtn.addEventListener('click', async () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  
  // Header
  doc.setFillColor(5, 5, 5);
  doc.rect(0, 0, 210, 40, 'F');
  doc.setTextColor(0, 242, 255);
  doc.setFontSize(24);
  doc.text('Affix-OG Clinical Report', 20, 25);
  doc.setTextColor(150);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 33);

  // Patient Info
  doc.setTextColor(50);
  doc.setFontSize(12);
  doc.text('Patient: John Doe | ID: #AFFIX-1024 | Diagnosis: Obstructive Sleep Apnea', 20, 50);

  // Chart Snapshot
  doc.setTextColor(150);
  doc.setFontSize(10);
  doc.text('Vital Signs Snapshot:', 20, 60);
  
  const chartArea = document.getElementById('dashboardContent');
  try {
    // Force black background for the capture so text is visible
    const canvas = await html2canvas(chartArea, { 
      backgroundColor: '#050505', 
      scale: 2,
      useCORS: true
    });
    const imgData = canvas.toDataURL('image/png');
    doc.addImage(imgData, 'PNG', 10, 65, 190, 100);
  } catch (e) {
    doc.text('Could not capture chart snapshot', 20, 70);
  }

  // Data Table (Last 80 params)
  let startY = 175;
  doc.setFontSize(12);
  doc.setTextColor(0, 242, 255);
  doc.text('Last 80 Biometric Readings (Raw Data Extract)', 20, startY);
  startY += 8;
  
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.setFont(undefined, 'bold');
  doc.text('Time', 20, startY);
  const keys = ['spo2', 'heart_rate', 'body_temp', 'ecg_val', 'motion', 'resp_snd'];
  keys.forEach((k, i) => doc.text(k, 55 + (i*25), startY));
  doc.setFont(undefined, 'normal');
  startY += 5;

  doc.setTextColor(50);
  dataBuffer.forEach((row) => {
    if (startY > 280) { 
      doc.addPage(); 
      startY = 20; 
    }
    doc.text(new Date(row._timestamp).toLocaleTimeString(), 20, startY);
    doc.text(String(row.spo2), 55, startY);
    doc.text(String(row.heart_rate), 80, startY);
    doc.text(String(row.body_temp), 105, startY);
    doc.text(String(row.ecg_val), 130, startY);
    doc.text(String(row.motion), 155, startY);
    doc.text(String(row.respiratory_sound), 180, startY);
    startY += 4;
  });

  doc.save('Affix-OG_Clinical_Report.pdf');
});


// ═══════════════════════════════════════════════════════════════════
// 5. AI SUGGESTIONS (Rule-Based + File Upload)
// ═══════════════════════════════════════════════════════════════════

// File Upload Dropzone Listeners
aiDropzone.addEventListener('click', () => fileInput.click());
aiDropzone.addEventListener('dragover', (e) => { e.preventDefault(); aiDropzone.classList.add('dragover'); });
aiDropzone.addEventListener('dragleave', () => aiDropzone.classList.remove('dragover'));
aiDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  aiDropzone.classList.remove('dragover');
  analyzeFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => analyzeFile(e.target.files[0]));

function analyzeFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      runRuleEngine(Array.isArray(data) ? data : [data]);
    } catch {
      // If file is invalid, fallback to live buffer
      runRuleEngine(dataBuffer.length > 0 ? dataBuffer : []);
    }
  };
  reader.readAsText(file);
}

analyzeLiveBtn.addEventListener('click', () => {
  if (dataBuffer.length === 0) {
    aiAnalysisContent.innerHTML = `<div class="ai-idle"><i class="fa-solid fa-circle-exclamation"></i><p>No live data buffered yet. Please wait for the stream to accumulate.</p></div>`;
    return;
  }
  runRuleEngine(dataBuffer);
});

function runRuleEngine(dataSet) {
  const alerts = [];
  
  // Mathematical Helpers
  const avg = (key) => dataSet.reduce((sum, d) => sum + (d[key]||0), 0) / dataSet.length;
  const min = (key) => Math.min(...dataSet.map(d => d[key]||0));
  const max = (key) => Math.max(...dataSet.map(d => d[key]||0));

  const avgSpO2 = avg('spo2');
  const minSpO2 = min('spo2');
  const avgHR = avg('heart_rate');
  const maxHR = max('heart_rate');
  const minHR = min('heart_rate');
  const avgTemp = avg('body_temp');
  const avgMotion = avg('motion');

  // Clinical Rules
  if (minSpO2 < 90) {
    alerts.push({ type: 'critical', title: 'Severe Hypoxemia Detected', msg: `SpO2 dropped to ${minSpO2.toFixed(1)}%. Immediate oxygen therapy recommended. Risk of hypoxic brain injury.` });
  } else if (avgSpO2 < 94) {
    alerts.push({ type: 'warning', title: 'Mild Hypoxemia / Apnea Indication', msg: `Average SpO2 is ${avgSpO2.toFixed(1)}%. Patient may require supplemental oxygen or CPAP evaluation during sleep.` });
  } else {
    alerts.push({ type: 'normal', title: 'Oxygenation Normal', msg: `SpO2 levels stable at ${avgSpO2.toFixed(1)}%. No hypoxemia detected.` });
  }

  if (maxHR > 110) {
    alerts.push({ type: 'critical', title: 'Tachycardia Event Captured', msg: `Heart rate peaked at ${Math.round(maxHR)} BPM. Possible cardiac stress, sleep terror, or apneic arousal event.` });
  } else if (avgHR > 85) {
    alerts.push({ type: 'warning', title: 'Elevated Heart Rate', msg: `Average HR is ${Math.round(avgHR)} BPM. Monitor for sustained tachycardia or pain response.` });
  } else if (minHR < 50) {
    alerts.push({ type: 'warning', title: 'Bradycardia Detected', msg: `Heart rate dropped to ${Math.round(minHR)} BPM. Assess for cardiac conduction abnormalities.` });
  }

  if (avgTemp > 37.5) {
    alerts.push({ type: 'warning', title: 'Pyrexia / Fever Indication', msg: `Core body temperature averaging ${avgTemp.toFixed(1)}°C. Evaluate for infection or hyperthermia.` });
  } else if (avgTemp < 35.5) {
    alerts.push({ type: 'warning', title: 'Hypothermia Risk', msg: `Core body temperature averaging ${avgTemp.toFixed(1)}°C. Check environmental controls and patient insulation.` });
  }

  if (avgMotion > 1.0) {
    alerts.push({ type: 'warning', title: 'Restless Sleep Pattern', msg: `High motion index detected (${avgMotion.toFixed(2)}). Periodic Limb Movement Disorder or severe insomnia possible.` });
  } else {
    alerts.push({ type: 'normal', title: 'Motion Levels Stable', msg: `Low motion index (${avgMotion.toFixed(2)}). No signs of restlessness or PLMD.` });
  }

  // Render Alerts
  aiAnalysisContent.innerHTML = alerts.map(a => `
    <div class="ai-alert ${a.type}">
      <h4><i class="fa-solid fa-${a.type === 'critical' ? 'triangle-exclamation' : a.type === 'warning' ? 'circle-exclamation' : 'circle-check'}"></i> ${a.title}</h4>
      <p>${a.msg}</p>
    </div>
  `).join('');
}


// ═══════════════════════════════════════════════════════════════════
// 6. STATUS UPDATES (Simulated Chronological Log)
// ═══════════════════════════════════════════════════════════════════
const alertTemplates = [
  { type: 'critical', icon: 'fa-phone', text: 'SMS Sent to 555-1234: Apnea threshold breached. SpO2 critical.' },
  { type: 'normal', icon: 'fa-satellite-dish', text: 'ESP32 Heartbeat Restored. Data streaming resumed at 10Hz.' },
  { type: 'critical', icon: 'fa-truck-medical', text: 'Code Blue Alert: Rapid Response Team notified for Bed 4.' },
  { type: 'normal', icon: 'fa-database', text: 'Patient history auto-saved to secure clinical database.' },
  { type: 'critical', icon: 'fa-bell', text: 'Tachycardia Warning: HR exceeded 120 BPM for >15 seconds.' },
  { type: 'normal', icon: 'fa-shield-halved', text: 'System Integrity Check: All biometric sensors calibrated.' }
];

function addStatusLog(item) {
  if (!statusLogList || !logEmpty) return;
  logEmpty.style.display = 'none';
  const time = new Date().toLocaleTimeString();
  const li = document.createElement('li');
  li.className = `log-item ${item.type}`;
  li.innerHTML = `
    <div class="log-icon"><i class="fa-solid ${item.icon}"></i></div>
    <div class="log-text"><strong>${item.type === 'critical' ? 'Critical Alert' : 'System Notification'}</strong><p>${item.text}</p></div>
    <span class="log-time">${time}</span>
  `;
  statusLogList.prepend(li);
}

// Simulate alerts every few seconds if viewing the Status Updates tab
setInterval(() => {
  const statusView = document.getElementById('view-status-updates');
  if (statusView && statusView.classList.contains('active') && Math.random() > 0.6) {
    addStatusLog(alertTemplates[Math.floor(Math.random() * alertTemplates.length)]);
  }
}, 4000);


// ═══════════════════════════════════════════════════════════════════
// INIT, CLOCK & SOCKET STATUS
// ═══════════════════════════════════════════════════════════════════
function updateClock() {
  topbarTime.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

socket.on('system:status', (status) => {
  if (!connectionBadge) return;
  if (status.esp32Connected) { 
    connectionBadge.className = 'connection-badge live'; 
    connectionBadge.querySelector('.conn-text').textContent = 'ESP32 Live'; 
  } else if (status.simulationActive) { 
    connectionBadge.className = 'connection-badge'; 
    connectionBadge.querySelector('.conn-text').textContent = 'Simulation'; 
  }
});

// Hero Particles (Simple generator if on Home view)
function createParticles() {
  const container = document.getElementById('heroParticles');
  if (!container) return;
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'hero-particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = (80 + Math.random() * 30) + '%';
    particle.style.animationDuration = (6 + Math.random() * 10) + 's';
    particle.style.animationDelay = Math.random() * 8 + 's';
    particle.style.width = (2 + Math.random() * 3) + 'px';
    particle.style.height = particle.style.width;
    if (Math.random() > 0.7) particle.style.background = 'var(--green)';
    container.appendChild(particle);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  switchView('home');
  createParticles();
  drawECG(); // Start ECG render loop
});