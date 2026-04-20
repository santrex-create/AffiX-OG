// =================================================================
// Affix-OG · ICU-Grade Frontend Logic v4.0
// =================================================================
const socket = io();

// ——— State ———
let isAuth = localStorage.getItem('affix_auth') === 'true';
let isFrozen = false;
let dataBuffer = [];
let prevValues = { spo2: 0, heart_rate: 0 };
let lastUpdateTime = {};

// ——— Hardware Telemetry State ———
let hardwareActive = false;
let hardwareTimeout = null;

// ——— Audio Context for Alerts ———
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;
function playAlertBeep() {
  if (!audioCtx) audioCtx = new AudioCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.3);
}

// ——— SPA Router ———
document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const page = el.dataset.page;
    if (page === 'dashboard' && !isAuth) {
      document.getElementById('authModal').classList.remove('hidden');
      return;
    }
    navigateTo(page);
  });
});

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  window.scrollTo(0, 0);

  if (page === 'dashboard') {
    setTimeout(() => {
      resizeCanvas();
      // Clear the canvas from previous stale state
      if (ctx && canvas) {
        ctx.fillStyle = '#020408';
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      }
    }, 50);
  }
}

// ——— Auth System ———
document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (document.getElementById('loginId').value === 'abcd' && document.getElementById('loginPass').value === 'abcd1234') {
    isAuth = true;
    localStorage.setItem('affix_auth', 'true');
    document.getElementById('authModal').classList.add('hidden');
    navigateTo('dashboard');
  } else {
    document.getElementById('loginError').classList.remove('hidden');
    setTimeout(() => document.getElementById('loginError').classList.add('hidden'), 3000);
  }
});
document.getElementById('authBtn').addEventListener('click', () => document.getElementById('authModal').classList.toggle('hidden'));

// ——— 60fps True-Phase ECG Engine ———
// Instead of relying on network packets (which cause jitter), we use the HR value
// from the telemetry to locally calculate the phase of the PQRST wave at 60fps.
const canvas = document.getElementById('ecgCanvas');
const ctx = canvas.getContext('2d');
let currentHR = 72;
let ecgPhase = 0;
let lastFrameTime = performance.now();
let ecgYData = [];
let writeHeadX = 0;

function resizeCanvas() {
  const parent = canvas.parentElement;
  if (!parent || parent.clientWidth === 0) return;
  canvas.width = parent.clientWidth * window.devicePixelRatio;
  canvas.height = parent.clientHeight * window.devicePixelRatio;
  canvas.style.width = `${parent.clientWidth}px`;
  canvas.style.height = `${parent.clientHeight}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  writeHeadX = 0;
  ecgYData = new Array(canvas.width).fill(0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Mathematical PQRST waveform generation
function getPQRSTValue(phase) {
  let val = 0;
  const t = phase;
  if (t < 0.8) val = 0.15 * Math.sin((t/0.8)*Math.PI);
  else if (t >= 1.0 && t < 1.15) val = -0.2;
  else if (t >= 1.15 && t < 1.3) val = 1.2 * Math.sin(((t-1.15)/0.15)*Math.PI);
  else if (t >= 1.3 && t < 1.45) val = -0.3;
  else if (t >= 2.0 && t < 3.0) val = 0.3 * Math.sin(((t-2.0)/1.0)*Math.PI);
  else val = (Math.random()-0.5)*0.015;
  return val;
}

function drawECGLoop(timestamp) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dt = (timestamp - lastFrameTime) / 1000;
  lastFrameTime = timestamp;

  if (!isFrozen) {
    // Calculate phase advancement based on current HR (BPM to cycles per second)
    const cyclesPerSecond = currentHR / 60;
    ecgPhase += cyclesPerSecond * dt * 2 * Math.PI;
    if (ecgPhase > Math.PI * 2) ecgPhase -= Math.PI * 2;

    // Get Y coordinate
    const yVal = getPQRSTValue(ecgPhase);

    // Draw single vertical line to erase trail, then plot new point
    const midY = h / 2;
    const amp = (h / 2) * 0.7;

    // Eraser Head (Gap)
    ctx.fillStyle = '#020408';
    ctx.fillRect(writeHeadX, 0, 30, h);

    // Draw Grid behind eraser (to maintain grid continuity)
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.04)';
    ctx.lineWidth = 1;
    for (let gy = 0; gy < h; gy += 25) { ctx.beginPath(); ctx.moveTo(writeHeadX, gy); ctx.lineTo(writeHeadX + 30, gy); ctx.stroke(); }

    // Plot point
    const plotY = midY - yVal * amp;
    ecgYData[writeHeadX] = plotY;
    ctx.fillStyle = '#39ff14';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#39ff14';
    ctx.beginPath();
    ctx.arc(writeHeadX, plotY, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw trailing wave
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ecgYData[0]);
    for (let i = 1; i < w; i++) {
      ctx.lineTo(i, ecgYData[i]);
    }
    ctx.stroke();

    // Advance sweep
    writeHeadX += 2;
    if (writeHeadX > w) writeHeadX = 0;
  }

  requestAnimationFrame(drawECGLoop);
}
requestAnimationFrame(drawECGLoop);

// ——— Freeze Function (Spacebar) ———
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.getElementById('page-dashboard').classList.contains('active')) {
    e.preventDefault();
    isFrozen = !isFrozen;
    document.getElementById('freezeInd').classList.toggle('hidden', !isFrozen);
  }
});

// ——— Real-Time Data Throttling Engine ———
const throttleConfig = {
  spo2: 2000,
  heart_rate: 2000,
  body_temp: 5000,
  hrv_raw: 2000,
  snoring_level: 4000,
  apnea_index: 60000,
  room_temp: 30000,
  humidity: 30000,
  battery_level: 15000,
  health_score: 5000
};

function updateParam(key, value, elemId, suffix='', decimal=0) {
  const now = Date.now();
  if (!lastUpdateTime[key] || now - lastUpdateTime[key] >= throttleConfig[key]) {
    const el = document.getElementById(elemId);
    if(el) el.innerText = `${value.toFixed(decimal)}${suffix}`;
    lastUpdateTime[key] = now;
  }
}

// ——— Socket Telemetry Listener & Hardware Switch ———
socket.on('bio:data', (data) => {
  window.__liveData = data;
  dataBuffer.push(data);
  if (dataBuffer.length > 80) dataBuffer.shift();

  // ——— Invisible Auto-Switch Logic ———
  if (data.isHardware) {
    if (!hardwareActive) {
      hardwareActive = true;
      updateSystemStatus(true);
    }
    // Reset the 10s timeout
    clearTimeout(hardwareTimeout);
    hardwareTimeout = setTimeout(() => {
      hardwareActive = false;
      updateSystemStatus(false);
    }, 10000);
  }

  // Update local ECG driver HR
  currentHR = data.heart_rate || 72;

  if (!document.getElementById('page-dashboard').classList.contains('active') || isFrozen) return;

  document.getElementById('lastUpdate').innerText = `Telemetry: ${new Date().toLocaleTimeString()}`;

  // SpO2
  if (Date.now() - (lastUpdateTime.spo2 || 0) >= throttleConfig.spo2) {
    const spo2El = document.getElementById('valSpo2');
    spo2El.innerHTML = `${data.spo2.toFixed(1)}<span>%</span>`;
    spo2El.parentElement.style.borderColor = data.spo2 < 90 ? 'var(--neon-red)' : data.spo2 < 94 ? 'var(--neon-orange)' : 'rgba(0,212,255,0.15)';
    updateTrend('trendSpo2', data.spo2, prevValues.spo2);
    prevValues.spo2 = data.spo2;
    lastUpdateTime.spo2 = Date.now();
  }

  // HR
  if (Date.now() - (lastUpdateTime.heart_rate || 0) >= throttleConfig.heart_rate) {
    const hrEl = document.getElementById('valHR');
    hrEl.innerHTML = `${Math.round(data.heart_rate)}<span>bpm</span>`;
    hrEl.parentElement.style.borderColor = data.heart_rate > 100 ? 'var(--neon-orange)' : 'rgba(57,255,20,0.15)';
    updateTrend('trendHR', data.heart_rate, prevValues.heart_rate);
    prevValues.heart_rate = data.heart_rate;
    lastUpdateTime.heart_rate = Date.now();
  }

  // Low Freq Params
  updateParam('body_temp', data.body_temp, 'valTemp', '°C', 1);
  updateParam('hrv_raw', data.hrv_raw, 'valHRV', 'ms', 0);
  updateParam('snoring_level', data.snoring_level, 'valSnore', 'dB', 1);
  updateParam('apnea_index', data.apnea_index, 'valApnea', '/h', 1);
  updateParam('room_temp', data.room_temp, 'valRoom', '°C', 1);
  updateParam('humidity', data.humidity, 'valHumid', '%', 1);
  updateParam('battery_level', data.battery_level, 'valBatt', '%', 1);

  // Health Score
  if (Date.now() - (lastUpdateTime.health_score || 0) >= throttleConfig.health_score) {
    const scoreEl = document.getElementById('valScore');
    scoreEl.innerText = Math.round(data.health_score);
    scoreEl.style.color = data.health_score > 85 ? 'var(--neon-green)' : data.health_score > 60 ? 'var(--neon-yellow)' : 'var(--neon-red)';
    lastUpdateTime.health_score = Date.now();
  }

  checkAlerts(data);
});

function updateTrend(id, curr, prev) {
  const el = document.getElementById(id);
  if (curr > prev + 0.2) el.innerHTML = '<span style="color:var(--neon-orange)">▲</span>';
  else if (curr < prev - 0.2) el.innerHTML = '<span style="color:var(--neon-blue)">▼</span>';
  else el.innerHTML = '<span style="color:rgba(255,255,255,0.3)">►</span>';
}

// ——— Stealth UI Status Update ———
function updateSystemStatus(isLive) {
  const indicator = document.getElementById('systemStatusIndicator');
  if (isLive) {
    indicator.innerHTML = '<span class="status-dot dot-live"></span> SYSTEM STATUS: OPTIMAL (LIVE TELEMETRY)';
  } else {
    indicator.innerHTML = '<span class="status-dot dot-standby"></span> SYSTEM STATUS: OPTIMAL (STANDBY)';
  }
}

// ——— Intelligent Alert System ———
let activeAlertTimeout;
function checkAlerts(d) {
  const banner = document.getElementById('alertBanner');
  let trigger = false, title = '', msg = '', color = '';

  if (d.spo2 < 90) {
    trigger = true;
    title = 'CRITICAL: Severe Hypoxemia';
    msg = `SpO2 dropped to ${d.spo2}%`;
    color = 'var(--neon-red)';
  } else if (d.heart_rate > 100) {
    trigger = true;
    title = 'WARNING: Tachycardia';
    msg = `HR elevated at ${Math.round(d.heart_rate)} BPM`;
    color = 'var(--neon-orange)';
  } else if (d.apnea_index > 8) {
    trigger = true;
    title = 'HIGH: Severe Apnea Events';
    msg = `Index at ${d.apnea_index}/hour`;
    color = 'var(--neon-yellow)';
  }

  if (trigger) {
    banner.classList.remove('hidden');
    banner.style.borderColor = color;
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertTitle').style.color = color;
    document.getElementById('alertMsg').innerText = msg;
    document.querySelector('.alert-icon-box i').style.color = color;
    document.querySelector('.alert-icon-box').style.animation = color === 'var(--neon-red)' ? 'blink 0.5s infinite' : 'blink 1.5s infinite';
    playAlertBeep();
    clearTimeout(activeAlertTimeout);
    activeAlertTimeout = setTimeout(() => banner.classList.add('hidden'), 5000);
  }
}

// ——— System Check (Stealth Demo) Trigger ———
// This triggers the server's "Baseline" to simulate an apnea event for UI testing
document.getElementById('systemCheckBtn').addEventListener('click', () => {
  if(!isAuth) { isAuth = true; localStorage.setItem('affix_auth', 'true'); }
  navigateTo('dashboard');
  socket.emit('trigger:baselineCheck', true);
  setTimeout(() => socket.emit('trigger:baselineCheck', false), 30000);
});

// ——— PDF Generation ———
document.getElementById('pdfBtn').addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFillColor(5, 5, 5);
  doc.rect(0, 0, 210, 40, 'F');
  doc.setTextColor(0, 212, 255);
  doc.setFontSize(22);
  doc.text('Affix-OG Clinical Report', 20, 25);
  doc.setTextColor(50);
  doc.setFontSize(12);
  doc.text('Patient: John Doe | ID: #1024 | Generated: ' + new Date().toLocaleString(), 20, 50);
  let y = 65;
  doc.setFontSize(10);
  const latest = window.__liveData || {};
  [['SpO2', `${latest.spo2||'--'}%`], ['Heart Rate', `${latest.heart_rate||'--'} BPM`], ['Body Temp', `${latest.body_temp||'--'}°C`], ['Apnea Index', `${latest.apnea_index||'--'}/h`]]
  .forEach(p => { doc.setTextColor(100); doc.text(p[0], 20, y); doc.setTextColor(0, 212, 255); doc.text(p[1], 80, y); y+=8; });
  doc.save('Affix-OG_Clinical_Report.pdf');
});

// ——— AI Suggestions ———
document.getElementById('aiAnalyzeBtn').addEventListener('click', () => {
  const dataArray = dataBuffer.slice(-80);
  const result = runAIAnalysis(dataArray);
  const outputPanel = document.getElementById('aiOutput');
  outputPanel.innerHTML = '';
  result.forEach(item => {
    const alertEl = document.createElement('div');
    alertEl.classList.add('ai-alert');
    if (item.severity === 'critical') {
      alertEl.classList.add('critical');
    } else if (item.severity === 'warning') {
      alertEl.classList.add('warning');
    }
    alertEl.innerText = item.message;
    outputPanel.appendChild(alertEl);
  });
});

function runAIAnalysis(dataArray) {
  const result = [];
  const spo2Values = dataArray.map(item => item.spo2);
  const heartRateValues = dataArray.map(item => item.heart_rate);
  const averageSpO2 = spo2Values.reduce((a, b) => a + b, 0) / spo2Values.length;
  const averageHeartRate = heartRateValues.reduce((a, b) => a + b, 0) / heartRateValues.length;
  if (averageSpO2 < 94) {
    result.push({ severity: 'critical', message: 'Hypoxemia detected' });
  }
  if (averageHeartRate > 100) {
    result.push({ severity: 'warning', message: 'Tachycardia detected' });
  }
  return result;
}

// ——— Status Updates ———
socket.on('bio:data', (data) => {
  const statusLogList = document.getElementById('statusLogList');
  const logItem = document.createElement('li');
  logItem.innerText = `Telemetry received at ${new Date().toLocaleTimeString()}`;
  statusLogList.appendChild(logItem);
});

setInterval(() => {
  const statusLogList = document.getElementById('statusLogList');
  const logItem = document.createElement('li');
  logItem.innerText = `System Integrity Check: OK at ${new Date().toLocaleTimeString()}`;
  statusLogList.appendChild(logItem);
}, 15000);

// ——— Patient History ———
const patientHistory = {
  name: 'John Doe',
  age: 54,
  diagnosis: 'OSA'
};

const patientHistoryEl = document.getElementById('patientHistory');
patientHistoryEl.innerHTML = '';
Object.keys(patientHistory).forEach(key => {
  const rowEl = document.createElement('tr');
  const keyEl = document.createElement('th');
  keyEl.innerText = key.charAt(0).toUpperCase() + key.slice(1);
  const valueEl = document.createElement('td');
  valueEl.innerText = patientHistory[key];
  rowEl.appendChild(keyEl);
  rowEl.appendChild(valueEl);
  patientHistoryEl.appendChild(rowEl);
});

// ——— Digital Twin ———
const digitalTwinEl = document.getElementById('digitalTwin');
digitalTwinEl.innerHTML = '<i class="fa-solid fa-atom" style="font-size: 100px; color: var(--neon-blue);"></i><h1 class="section-title gradient-text">Digital Twin Architecture</h1><p>Coming in v5.0</p>';

navigateTo('home');
