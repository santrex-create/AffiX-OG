// =============================================================================
// Affix-OG · Smart Sleep & Health Monitoring System
// server.js — High-performance Node.js backend v1.1.0
// =============================================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  PORT: process.env.PORT || 3000,
  BROADCAST_INTERVAL_MS: 100, // 10Hz = 100ms → smooth 60FPS frontend rendering
  SIMULATION_TIMEOUT_MS: 5000, // Auto-activate simulation after 5s of no ESP32 data
};

// The 12 biometric parameters expected from the ESP32
const ESP32_KEYS = [
  'spo2',             // Blood oxygen saturation (%)
  'heart_rate',       // Heart rate (BPM)
  'ecg_val',          // ECG instantaneous value (mV)
  'body_temp',        // Core body temperature (°C)
  'motion',           // Accelerometer motion magnitude
  'respiratory_sound',// Respiratory acoustic level (dB)
  'humidity',         // Room humidity (%)
  'room_temp',        // Ambient room temperature (°C)
  'hrv_raw',          // Heart rate variability raw (ms)
  'signal_quality',   // Sensor signal quality index (0-100)
  'device_status',    // Device status code (0=offline, 1=online, 2=warning)
  'battery_level',    // Battery percentage (0-100)
];

// ─── Express & HTTP Setup ───────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static files from /public (includes assets folder for logos)
app.use(express.static(path.join(__dirname, 'public')));

// Health-check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    esp32Connected,
    simulationActive,
    connectedClients: io ? io.engine.clientsCount : 0,
    timestamp: Date.now(),
  });
});

// REST fallback for ESP32 (if WebSocket unavailable)
app.post('/api/esp32/data', (req, res) => {
  const data = req.body;
  if (validateESP32Data(data)) {
    ingestESP32Data(data);
    res.status(200).json({ received: true });
  } else {
    res.status(400).json({ received: false, error: 'Invalid data format' });
  }
});

const server = http.createServer(app);

// ─── Socket.IO Setup ────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: '*', // Tighten in production
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e6, // 1MB
});

// ─── State Management ───────────────────────────────────────────────────────
let esp32Connected = false;
let lastESP32DataTime = 0;
let simulationActive = false;
let simulationTimer = null;
let broadcastTimer = null;

// Buffered latest data snapshot — broadcast at 10Hz regardless of input rate
let latestDataSnapshot = null;

// Simulation state: persistent random-walk values for realism
const simState = {
  spo2: 97.5,
  heart_rate: 72,
  ecg_val: 0.0,
  body_temp: 36.6,
  motion: 0.05,
  respiratory_sound: 35,
  humidity: 55,
  room_temp: 22.5,
  hrv_raw: 55,
  signal_quality: 95,
  device_status: 1,
  battery_level: 87,
};

// ─── Data Validation ────────────────────────────────────────────────────────
function validateESP32Data(data) {
  if (!data || typeof data !== 'object') return false;
  const presentKeys = ESP32_KEYS.filter(k => data[k] !== undefined);
  return presentKeys.length >= 8; // Allow some missing keys for flexibility
}

// ─── ESP32 Data Ingestion ───────────────────────────────────────────────────
function ingestESP32Data(data) {
  esp32Connected = true;
  lastESP32DataTime = Date.now();

  // Fill missing keys with null for frontend consistency
  const normalized = {};
  for (const key of ESP32_KEYS) {
    normalized[key] = data[key] !== undefined ? data[key] : null;
  }
  normalized._timestamp = Date.now();
  normalized._source = 'esp32';

  latestDataSnapshot = normalized;

  // If simulation was running, deactivate it
  if (simulationActive) {
    console.log('[Affix-OG] ✅ ESP32 data received — deactivating simulation mode');
    simulationActive = false;
    if (simulationTimer) {
      clearInterval(simulationTimer);
      simulationTimer = null;
    }
  }
}

// ─── Socket.IO Connection Handling ──────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Affix-OG] 🖥️  Client connected: ${socket.id} (total: ${io.engine.clientsCount})`);

  // Send current state to newly connected client
  socket.emit('system:status', {
    esp32Connected,
    simulationActive,
    timestamp: Date.now(),
  });

  if (latestDataSnapshot) {
    socket.emit('bio:data', latestDataSnapshot);
  }

  // ── ESP32 device connects via WebSocket ──
  socket.on('esp32:connect', () => {
    console.log(`[Affix-OG] 🔵 ESP32 device connected: ${socket.id}`);
    socket.join('esp32-devices');
    esp32Connected = true;
    lastESP32DataTime = Date.now();
    io.emit('system:status', { esp32Connected: true, simulationActive: false, timestamp: Date.now() });
  });

  // ── ESP32 sends real-time biometric data ──
  socket.on('esp32:data', (data) => {
    if (validateESP32Data(data)) {
      ingestESP32Data(data);
    } else {
      console.warn(`[Affix-OG] ⚠️  Invalid ESP32 data from ${socket.id}`);
    }
  });

  // ── ESP32 disconnects ──
  socket.on('disconnect', () => {
    console.log(`[Affix-OG] 🔴 Disconnected: ${socket.id}`);
    if (socket.rooms.has('esp32-devices')) {
      esp32Connected = false;
      io.emit('system:status', { esp32Connected: false, simulationActive, timestamp: Date.now() });
      console.log('[Affix-OG] 🔵 ESP32 device disconnected');
    }
  });
});

// ─── Simulation Engine ──────────────────────────────────────────────────────
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function randomWalk(current, step, min, max) {
  const delta = (Math.random() - 0.5) * 2 * step;
  return clamp(current + delta, min, max);
}

// ECG waveform simulation: dynamic PQRST complex tied to heart_rate
let ecgPhase = 0;
function generateECG() {
  // Calculate phase increment based on current heart rate to ensure the ECG wave matches the BPM
  // HR in BPM -> beats per second -> multiply by interval (0.1s) -> multiply by 2PI for full cycle
  const beatsPerSecond = simState.heart_rate / 60;
  const phaseIncrement = beatsPerSecond * (CONFIG.BROADCAST_INTERVAL_MS / 1000) * 2 * Math.PI;
  
  ecgPhase += phaseIncrement;
  if (ecgPhase > Math.PI * 2) ecgPhase -= Math.PI * 2;

  let val = 0;
  const t = ecgPhase;

  // P-wave (small bump at start)
  if (t < 0.8) {
    val = 0.15 * Math.sin((t / 0.8) * Math.PI);
  }
  // QRS complex (sharp spike)
  else if (t >= 1.0 && t < 1.15) {
    val = -0.2;
  } else if (t >= 1.15 && t < 1.3) {
    val = 1.2 * Math.sin(((t - 1.15) / 0.15) * Math.PI);
  } else if (t >= 1.3 && t < 1.45) {
    val = -0.3;
  }
  // T-wave (broad bump)
  else if (t >= 2.0 && t < 3.0) {
    val = 0.3 * Math.sin(((t - 2.0) / 1.0) * Math.PI);
  }
  // Baseline noise
  else {
    val = (Math.random() - 0.5) * 0.02;
  }

  return clamp(val, -0.5, 1.5);
}

function generateSimulationData() {
  // Slow drift on vitals
  simState.spo2 = randomWalk(simState.spo2, 0.1, 94, 100);
  simState.heart_rate = randomWalk(simState.heart_rate, 0.5, 55, 100);
  simState.body_temp = randomWalk(simState.body_temp, 0.01, 35.5, 38.0);
  simState.motion = randomWalk(simState.motion, 0.02, 0, 2.0);
  simState.respiratory_sound = randomWalk(simState.respiratory_sound, 0.5, 20, 60);
  simState.humidity = randomWalk(simState.humidity, 0.2, 30, 80);
  simState.room_temp = randomWalk(simState.room_temp, 0.05, 18, 28);
  simState.hrv_raw = randomWalk(simState.hrv_raw, 1.0, 20, 100);
  simState.signal_quality = randomWalk(simState.signal_quality, 0.5, 70, 100);
  simState.battery_level = Math.max(0, simState.battery_level - 0.001); // Very slow drain

  // ECG gets its own waveform generator
  simState.ecg_val = generateECG();

  // Occasional device status flicker (rare warning)
  simState.device_status = Math.random() > 0.999 ? 2 : 1;

  return {
    spo2: parseFloat(simState.spo2.toFixed(1)),
    heart_rate: Math.round(simState.heart_rate),
    ecg_val: parseFloat(simState.ecg_val.toFixed(3)),
    body_temp: parseFloat(simState.body_temp.toFixed(1)),
    motion: parseFloat(simState.motion.toFixed(3)),
    respiratory_sound: parseFloat(simState.respiratory_sound.toFixed(1)),
    humidity: parseFloat(simState.humidity.toFixed(1)),
    room_temp: parseFloat(simState.room_temp.toFixed(1)),
    hrv_raw: Math.round(simState.hrv_raw),
    signal_quality: Math.round(simState.signal_quality),
    device_status: simState.device_status,
    battery_level: parseFloat(simState.battery_level.toFixed(1)),
    _timestamp: Date.now(),
    _source: 'simulation',
  };
}

function startSimulation() {
  if (simulationActive) return;
  simulationActive = true;
  console.log('[Affix-OG] 🧪 Simulation mode ACTIVATED — generating fake biometric data at 10Hz');

  // Generate data at the same 10Hz rate as the broadcast
  simulationTimer = setInterval(() => {
    latestDataSnapshot = generateSimulationData();
  }, CONFIG.BROADCAST_INTERVAL_MS);
}

function stopSimulation() {
  if (!simulationActive) return;
  simulationActive = false;
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }
  console.log('[Affix-OG] 🧪 Simulation mode DEACTIVATED');
}

// ─── Broadcast Loop (10Hz) ──────────────────────────────────────────────────
function startBroadcastLoop() {
  broadcastTimer = setInterval(() => {
    if (latestDataSnapshot && io.engine.clientsCount > 0) {
      io.emit('bio:data', latestDataSnapshot);
    }

    // Check if ESP32 has gone silent → activate simulation
    if (
      !simulationActive &&
      lastESP32DataTime > 0 &&
      Date.now() - lastESP32DataTime > CONFIG.SIMULATION_TIMEOUT_MS
    ) {
      esp32Connected = false;
      io.emit('system:status', {
        esp32Connected: false,
        simulationActive: true,
        timestamp: Date.now(),
      });
      startSimulation();
    }
  }, CONFIG.BROADCAST_INTERVAL_MS);
}

// ─── Auto-start simulation if no ESP32 ever connects ────────────────────────
setTimeout(() => {
  if (!esp32Connected && !simulationActive) {
    console.log('[Affix-OG] ⏱️  No ESP32 detected after startup — auto-starting simulation');
    startSimulation();
  }
}, CONFIG.SIMULATION_TIMEOUT_MS);

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[Affix-OG] 🛑 Received ${signal} — shutting down gracefully...`);

  if (broadcastTimer) clearInterval(broadcastTimer);
  if (simulationTimer) clearInterval(simulationTimer);

  io.disconnectSockets(true);
  server.close(() => {
    console.log('[Affix-OG] Server closed. Goodbye.');
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ─── Start Server ───────────────────────────────────────────────────────────
server.listen(CONFIG.PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║       Affix-OG · Backend Online v1.1.0       ║');
  console.log('  ║   Smart Sleep & Health Monitoring System     ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║   HTTP:   http://localhost:${CONFIG.PORT}              ║`);
  console.log(`  ║   WS:     ws://localhost:${CONFIG.PORT}               ║`);
  console.log(`  ║   Freq:   10Hz (100ms broadcast)             ║`);
  console.log(`  ║   Params: 12 biometric channels              ║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║   Waiting for ESP32 or starting simulation...║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  startBroadcastLoop();
});