// =============================================================================
// Affix-OG · ICU-Grade Telemetry Server v4.0
// =============================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ——— Internal Baseline State ———
const baseline = {
  spo2: 98,
  heart_rate: 72,
  ecg_val: 0.0,
  body_temp: 36.5,
  motion: 0.1,
  respiratory_sound: 35,
  humidity: 55,
  room_temp: 30.0,
  hrv_raw: 55,
  signal_quality: 95,
  device_status: 1,
  battery_level: 94,
  snoring_level: 12,
  health_score: 88,
  apnea_index: 1.2,
  alert_priority: 0
};

let ecgPhase = 0;
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function rw(c, s, min, max) { return clamp(c + (Math.random()-0.5)*2*s, min, max); }

function generateBaseline() {
  baseline.heart_rate = rw(baseline.heart_rate, 0.5, 58, 90);
  baseline.spo2 = rw(baseline.spo2, 0.1, 95, 100);
  baseline.apnea_index = rw(baseline.apnea_index, 0.05, 0, 2);
  baseline.snoring_level = rw(baseline.snoring_level, 1, 0, 20);
  baseline.body_temp = rw(baseline.body_temp, 0.005, 36.3, 36.8);
  baseline.hrv_raw = rw(baseline.hrv_raw, 1, 40, 70);
  baseline.room_temp = rw(baseline.room_temp, 0.05, 28, 32);
  baseline.humidity = rw(baseline.humidity, 0.1, 45, 55);
  baseline.battery_level = Math.max(0, baseline.battery_level - 0.0001);

  baseline.health_score = clamp(100 - (baseline.apnea_index * 3) - ((100-baseline.spo2)*2), 0, 100);
  baseline.alert_priority = 0;

  // Generate ECG locally just in case, though client interpolates
  const bps = baseline.heart_rate / 60;
  ecgPhase += bps * 0.1 * 2 * Math.PI;
  if (ecgPhase > Math.PI * 2) ecgPhase -= Math.PI * 2;
  let val = 0;
  const t = ecgPhase;
  if (t < 0.8) val = 0.15 * Math.sin((t/0.8)*Math.PI);
  else if (t >= 1.0 && t < 1.15) val = -0.2;
  else if (t >= 1.15 && t < 1.3) val = 1.2 * Math.sin(((t-1.15)/0.15)*Math.PI);
  else if (t >= 1.3 && t < 1.45) val = -0.3;
  else if (t >= 2.0 && t < 3.0) val = 0.3 * Math.sin(((t-2.0)/1.0)*Math.PI);
  else val = (Math.random()-0.5)*0.02;
  baseline.ecg_val = clamp(val, -0.5, 1.5);

  return {
    ...baseline,
    spo2: parseFloat(baseline.spo2.toFixed(1)),
    heart_rate: Math.round(baseline.heart_rate),
    ecg_val: parseFloat(baseline.ecg_val.toFixed(3)),
    body_temp: parseFloat(baseline.body_temp.toFixed(1)),
    motion: parseFloat(rw(baseline.motion, 0.02, 0, 0.5).toFixed(3)),
    respiratory_sound: parseFloat(rw(baseline.respiratory_sound, 0.5, 20, 30).toFixed(1)),
    humidity: parseFloat(baseline.humidity.toFixed(1)),
    room_temp: parseFloat(baseline.room_temp.toFixed(1)),
    hrv_raw: Math.round(baseline.hrv_raw),
    signal_quality: Math.round(rw(baseline.signal_quality, 0.5, 90, 100)),
    battery_level: parseFloat(baseline.battery_level.toFixed(1)),
    snoring_level: parseFloat(baseline.snoring_level.toFixed(1)),
    health_score: Math.round(baseline.health_score),
    apnea_index: parseFloat(baseline.apnea_index.toFixed(1)),
    _timestamp: Date.now(),
    isHardware: false
  };
}

// ——— Hardware Telemetry State ———
let hardwareData = null;
let lastHardwareTime = 0;

io.on('connection', (socket) => {
  console.log('🖥️ Client connected');

  // Listen for physical ESP32 device
  socket.on('sensorData', (data) => {
    // Ensure data matches our expected schema before accepting
    if(data.heart_rate && data.spo2) {
      hardwareData = { ...data, isHardware: true, _timestamp: Date.now() };
      lastHardwareTime = Date.now();
    }
  });

  socket.on('disconnect', () => {});
});

// ——— 10Hz Unified Broadcast Loop ———
setInterval(() => {
  if (io.engine.clientsCount > 0) {
    // If hardware data is fresh (within 10 seconds), use it. Otherwise, fallback.
    if (hardwareData && (Date.now() - lastHardwareTime < 10000)) {
      io.emit('bio:data', hardwareData);
    } else {
      hardwareData = null;
      io.emit('bio:data', generateBaseline());
    }
  }
}, 100);

server.listen(3000, () => console.log('🫀 Affix-OG Telemetry Server running on http://localhost:3000'));