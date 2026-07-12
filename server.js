const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  port: 3000,
  clearingToEmptyMs: 30 * 1000,
  maxEvents: 5000,
  dataFile: 'data/state.json',
  saveDebounceMs: 2000,
  stores: {
    'store-001': { name: 'DeFacto Bağcılar AVM', cabinCount: 13 },
  },
};

const VALID_STATES = ['empty', 'full', 'clearing'];
const DEMO_FULL_CABINS = {
  'store-001': [1, 3, 4, 6, 9],
};

function loadConfig(configPath) {
  let fromFile = {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    fromFile = JSON.parse(raw);
  } catch (err) {
    console.warn(`[config] Could not read ${configPath} (${err.code || err.message}). Using defaults.`);
  }

  const merged = { ...DEFAULT_CONFIG, ...fromFile, stores: { ...DEFAULT_CONFIG.stores, ...(fromFile.stores || {}) } };

  if (process.env.PORT) merged.port = parseInt(process.env.PORT, 10);
  if (process.env.CLEARING_TO_EMPTY_MS) merged.clearingToEmptyMs = parseInt(process.env.CLEARING_TO_EMPTY_MS, 10);

  return merged;
}

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = loadConfig(CONFIG_PATH);

const PORT = config.port;
const CLEARING_TO_EMPTY_MS = config.clearingToEmptyMs;
const MAX_EVENTS = config.maxEvents;
const STORES = config.stores;
const DATA_FILE = path.join(__dirname, config.dataFile);

const STATIC_FILES = {
  '/kiosk': 'kiosk.html',
  '/kiosk.html': 'kiosk.html',
  '/simulator': 'simulator.html',
  '/simulator.html': 'simulator.html',
  '/dashboard': 'dashboard.html',
  '/dashboard.html': 'dashboard.html',
};

// ─── STATE ─────────────────────────────────────────────────────────────────
const stores = {};
const timers = {};
const dwellStart = {};
const clearingStart = {};
let analyticsLog = [];
let saveTimer = null;

function applyDemoState(storeId, cabins) {
  const fullCabins = DEMO_FULL_CABINS[storeId] || [];
  cabins.forEach(cabin => {
    cabin.state = fullCabins.includes(cabin.id) ? 'full' : 'empty';
  });
  return cabins;
}

function initStore(storeId) {
  const store = STORES[storeId];
  if (!store) return;
  stores[storeId] = {
    cabins: applyDemoState(storeId, Array.from({ length: store.cabinCount }, (_, i) => ({
      id: i + 1,
      state: 'empty',
    }))),
  };
  console.log(`[${storeId}] Store initialized — ${store.cabinCount} cabins`);
}

Object.keys(STORES).forEach(initStore);

// ─── PERSISTENCE ───────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const saved = JSON.parse(raw);

    Object.keys(saved.stores || {}).forEach(storeId => {
      if (!stores[storeId]) return;
      const savedCabins = saved.stores[storeId].cabins || [];
      stores[storeId].cabins.forEach(cabin => {
        const match = savedCabins.find(c => c.id === cabin.id);
        if (match && VALID_STATES.includes(match.state)) cabin.state = match.state;
      });
      applyDemoState(storeId, stores[storeId].cabins);
    });

    if (Array.isArray(saved.analyticsLog)) {
      analyticsLog = saved.analyticsLog.slice(-MAX_EVENTS);
    }

    console.log(`[persistence] Restored state from ${DATA_FILE} (saved ${saved.savedAt || 'unknown time'})`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[persistence] No prior state file found at ${DATA_FILE}, starting fresh`);
    } else {
      console.warn(`[persistence] Failed to load state: ${err.message}. Starting fresh.`);
    }
  }
}

function saveStateNow() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const snapshot = {
      savedAt: new Date().toISOString(),
      stores: Object.fromEntries(
        Object.entries(stores).map(([id, s]) => [id, { cabins: s.cabins }])
      ),
      analyticsLog,
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error(`[persistence] Failed to save state: ${err.message}`);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, config.saveDebounceMs);
}

loadState();

// ─── ANALYTICS ─────────────────────────────────────────────────────────────
function logEvent(storeId, cabinId, fromState, toState) {
  const now = Date.now();
  const key = `${storeId}-${cabinId}`;

  let dwellMs = null;
  if (fromState === 'full' && dwellStart[key]) {
    dwellMs = now - dwellStart[key];
    delete dwellStart[key];
  }
  if (toState === 'full') {
    dwellStart[key] = now;
  }

  let clearingMs = null;
  if (fromState === 'clearing' && clearingStart[key]) {
    clearingMs = now - clearingStart[key];
    delete clearingStart[key];
  }
  if (toState === 'clearing') {
    clearingStart[key] = now;
  }

  const event = { ts: now, storeId, cabinId, fromState, toState, dwellMs, clearingMs };
  analyticsLog.push(event);
  if (analyticsLog.length > MAX_EVENTS) analyticsLog.shift();
  return event;
}

function getStoreSummary(storeId, sinceMs = 8 * 60 * 60 * 1000) {
  const since = Date.now() - sinceMs;
  const events = analyticsLog.filter(e => e.storeId === storeId && e.ts >= since);

  const dwellByCabin = {};
  const clearingByCabin = {};
  const usageByCabin = {};

  events.forEach(e => {
    if (e.dwellMs !== null) {
      if (!dwellByCabin[e.cabinId]) dwellByCabin[e.cabinId] = [];
      dwellByCabin[e.cabinId].push(e.dwellMs);
    }
    if (e.clearingMs !== null) {
      if (!clearingByCabin[e.cabinId]) clearingByCabin[e.cabinId] = [];
      clearingByCabin[e.cabinId].push(e.clearingMs);
    }
    if (e.toState === 'full') {
      usageByCabin[e.cabinId] = (usageByCabin[e.cabinId] || 0) + 1;
    }
  });

  const avgDwell = {};
  Object.keys(dwellByCabin).forEach(id => {
    const arr = dwellByCabin[id];
    avgDwell[id] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 1000);
  });

  const avgClearing = {};
  const clearingCountByCabin = {};
  Object.keys(clearingByCabin).forEach(id => {
    const arr = clearingByCabin[id];
    avgClearing[id] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 1000);
    clearingCountByCabin[id] = arr.length;
  });

  const allClearingVals = Object.values(clearingByCabin).flat();
  const overallAvgClearing = allClearingVals.length
    ? Math.round(allClearingVals.reduce((a, b) => a + b, 0) / allClearingVals.length / 1000)
    : null;

  let slowestCabin = null;
  let slowestTime = 0;
  Object.keys(avgClearing).forEach(id => {
    if (avgClearing[id] > slowestTime) {
      slowestTime = avgClearing[id];
      slowestCabin = Number(id);
    }
  });

  const hourlyBuckets = {};
  events.filter(e => e.toState === 'full').forEach(e => {
    const hour = new Date(e.ts).getHours();
    hourlyBuckets[hour] = (hourlyBuckets[hour] || 0) + 1;
  });

  const store = stores[storeId];
  const occupied = store ? store.cabins.filter(c => c.state === 'full').length : 0;
  const total = store ? store.cabins.length : 0;

  return {
    storeId,
    storeName: STORES[storeId]?.name,
    currentOccupied: occupied,
    currentFree: total - occupied,
    totalCabins: total,
    periodHours: sinceMs / 3600000,
    totalVisits: events.filter(e => e.toState === 'full').length,
    avgDwellByCabin: avgDwell,
    usageCountByCabin: usageByCabin,
    hourlyTraffic: hourlyBuckets,
    avgClearingByCabin: avgClearing,
    clearingCountByCabin: clearingCountByCabin,
    overallAvgClearingS: overallAvgClearing,
    slowestCabin,
    slowestCabinTimeS: slowestTime || null,
  };
}

// ─── STATE MACHINE ─────────────────────────────────────────────────────────
function broadcast(storeId, data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.storeId === storeId) {
      client.send(message);
    }
  });
}

function setCabinState(storeId, cabinId, newState) {
  if (!VALID_STATES.includes(newState)) {
    return { ok: false, changed: false, error: `Invalid state "${newState}". Must be one of: ${VALID_STATES.join(', ')}` };
  }

  const store = stores[storeId];
  if (!store) {
    return { ok: false, changed: false, error: `Unknown store: ${storeId}` };
  }

  const cabin = store.cabins.find(c => c.id === cabinId);
  if (!cabin) {
    return { ok: false, changed: false, error: `Unknown cabin: ${cabinId} in ${storeId}` };
  }

  const oldState = cabin.state;
  if (oldState === newState) {
    return { ok: true, changed: false };
  }

  cabin.state = newState;
  console.log(`[${storeId}] Cabin ${cabinId}: ${oldState} → ${newState}`);

  const event = logEvent(storeId, cabinId, oldState, newState);
  broadcast(storeId, { type: 'update', id: cabinId, state: newState });
  scheduleSave();

  const key = `${storeId}-${cabinId}`;
  if (timers[key]) {
    clearTimeout(timers[key]);
    delete timers[key];
  }

  if (newState === 'clearing') {
    timers[key] = setTimeout(() => {
      console.log(`[${storeId}] Cabin ${cabinId} — clearing timer fired → empty`);
      setCabinState(storeId, cabinId, 'empty');
    }, CLEARING_TO_EMPTY_MS);
  }

  return { ok: true, changed: true, event };
}

// ─── HTTP SERVER ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const reqPath = parsed.pathname;

  if (req.method === 'GET' && STATIC_FILES[reqPath]) {
    const filePath = path.join(__dirname, STATIC_FILES[reqPath]);
    return fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('File not found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && reqPath === '/api/health') {
    return res.end(JSON.stringify({
      status: 'ok',
      uptimeS: Math.round(process.uptime()),
      stores: Object.keys(STORES),
      clientsConnected: wss.clients.size,
    }));
  }

  if (req.method === 'GET' && reqPath === '/api/config') {
    return res.end(JSON.stringify({
      clearingToEmptyMs: CLEARING_TO_EMPTY_MS,
      stores: Object.keys(STORES).map(id => ({ id, name: STORES[id].name, cabinCount: STORES[id].cabinCount })),
    }));
  }

  if (req.method === 'GET' && reqPath === '/api/stores') {
    return res.end(JSON.stringify(Object.keys(STORES).map(id => ({
      id,
      ...STORES[id],
      currentState: stores[id]?.cabins || [],
    }))));
  }

  const analyticsMatch = reqPath.match(/^\/api\/analytics\/(.+)$/);
  if (req.method === 'GET' && analyticsMatch) {
    const storeId = analyticsMatch[1];
    if (!STORES[storeId]) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Store not found' }));
    }
    const hours = parseFloat(parsed.query.hours) || 8;
    return res.end(JSON.stringify(getStoreSummary(storeId, hours * 3600000)));
  }

  const eventsMatch = reqPath.match(/^\/api\/events\/(.+)$/);
  if (req.method === 'GET' && eventsMatch) {
    const storeId = eventsMatch[1];
    const format = parsed.query.format;
    const storeEvents = analyticsLog.filter(e => e.storeId === storeId).slice(-200);

    if (format === 'csv') {
      const header = 'ts,iso,storeId,cabinId,fromState,toState,dwellMs,clearingMs';
      const rows = storeEvents.map(e =>
        [e.ts, new Date(e.ts).toISOString(), e.storeId, e.cabinId, e.fromState, e.toState, e.dwellMs ?? '', e.clearingMs ?? ''].join(',')
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${storeId}-events.csv"`);
      return res.end([header, ...rows].join('\n'));
    }

    return res.end(JSON.stringify(storeEvents));
  }

  res.writeHead(200);
  res.end(JSON.stringify({ status: 'Cabin Tracker Server running', stores: Object.keys(STORES) }));
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const params = url.parse(req.url, true).query;
  const storeId = params.store || 'store-001';

  if (!stores[storeId]) {
    console.warn(`Connection attempt for unknown store: ${storeId}`);
    ws.close(1008, 'Unknown store');
    return;
  }

  ws.storeId = storeId;
  console.log(`[${storeId}] Client connected`);

  ws.send(JSON.stringify({
    type: 'init',
    storeId,
    storeName: STORES[storeId].name,
    cabins: stores[storeId].cabins,
    clearingToEmptyMs: CLEARING_TO_EMPTY_MS,
  }));

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'update') {
        const result = setCabinState(storeId, Number(data.id), data.state);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
      }
    } catch (err) {
      console.error(`[${storeId}] Invalid message:`, err.message);
    }
  });

  ws.on('close', () => console.log(`[${storeId}] Client disconnected`));
  ws.on('error', (err) => console.error(`[${storeId}] WS error:`, err.message));
});

let pingInterval;

function start() {
  pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(pingInterval));

  server.listen(PORT, () => {
    console.log(`\nCabin Tracker Server — http://localhost:${PORT}`);
    console.log(`Stores: ${Object.keys(STORES).join(', ')}`);
    console.log(`Clearing timer: ${CLEARING_TO_EMPTY_MS / 1000}s`);
    console.log(`\nPages:`);
    console.log(`  GET /kiosk`);
    console.log(`  GET /simulator`);
    console.log(`  GET /dashboard`);
    console.log(`\nAPI endpoints:`);
    console.log(`  GET /api/health`);
    console.log(`  GET /api/config`);
    console.log(`  GET /api/stores`);
    console.log(`  GET /api/analytics/:storeId?hours=8`);
    console.log(`  GET /api/events/:storeId[?format=csv]`);
    console.log(`\nWebSocket: ws://localhost:${PORT}?store=store-001\n`);
  });

  function shutdown(signal) {
    console.log(`\n[${signal}] Shutting down — saving state…`);
    clearTimeout(saveTimer);
    saveStateNow();
    clearInterval(pingInterval);
    wss.close(() => {
      server.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 2000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  start();
}

module.exports = {
  server,
  config,
  loadConfig,
  stores,
  STORES,
  setCabinState,
  getStoreSummary,
  logEvent,
  saveStateNow,
  loadState,
  start,
};
