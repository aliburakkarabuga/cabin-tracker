const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');
const WebSocket = require('ws');

const ROOT_DIR = __dirname;
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const DEFAULT_CONFIG = {
  port: 3000,
  clearingToEmptyMs: 30 * 1000,
  maxEvents: 5000,
  dataFile: 'data/state.json',
  stores: {
    'store-001': { name: 'DeFacto Bağcılar AVM', cabinCount: 13 },
  },
};
const VALID_STATES = new Set(['empty', 'full', 'clearing']);
const STATIC_ROUTES = {
  '/': 'kiosk.html',
  '/kiosk': 'kiosk.html',
  '/kiosk.html': 'kiosk.html',
  '/simulator': 'simulator.html',
  '/simulator.html': 'simulator.html',
  '/dashboard': 'dashboard.html',
  '/dashboard.html': 'dashboard.html',
};
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function loadConfig(configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) return DEFAULT_CONFIG;
  const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return { ...DEFAULT_CONFIG, ...userConfig, stores: userConfig.stores || DEFAULT_CONFIG.stores };
}

const config = loadConfig();
const PORT = Number(process.env.PORT || config.port || 3000);
const CLEARING_TO_EMPTY_MS = Number(process.env.CLEARING_TO_EMPTY_MS || config.clearingToEmptyMs || 30000);
const MAX_EVENTS = Number(config.maxEvents || 5000);
const STORES = config.stores;
const DATA_FILE = path.isAbsolute(config.dataFile) ? config.dataFile : path.join(ROOT_DIR, config.dataFile);

const stores = {};
const timers = {};
const dwellStart = {};
const analyticsLog = [];
let wss;
let saveTimer;

function initStore(storeId, savedCabins = null) {
  const store = STORES[storeId];
  if (!store) return;
  const cabins = Array.from({ length: store.cabinCount }, (_, i) => {
    const id = i + 1;
    const saved = savedCabins?.find(cabin => cabin.id === id);
    return { id, state: VALID_STATES.has(saved?.state) ? saved.state : 'empty' };
  });
  stores[storeId] = { cabins };
}

function loadPersistedState() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed.analyticsLog)) analyticsLog.push(...parsed.analyticsLog.slice(-MAX_EVENTS));
    Object.keys(STORES).forEach(storeId => initStore(storeId, parsed.stores?.[storeId]?.cabins));
  } catch (error) {
    console.warn(`Could not load persisted state: ${error.message}`);
  }
}

function serializeState() {
  return {
    savedAt: new Date().toISOString(),
    stores,
    analyticsLog: analyticsLog.slice(-MAX_EVENTS),
  };
}

function saveStateNow() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(serializeState(), null, 2));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { saveStateNow(); } catch (error) { console.error(`Could not save state: ${error.message}`); }
  }, 150);
}

Object.keys(STORES).forEach(storeId => initStore(storeId));
loadPersistedState();
Object.keys(STORES).forEach(storeId => { if (!stores[storeId]) initStore(storeId); });

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res, pathname) {
  const mappedFile = STATIC_ROUTES[pathname];
  if (!mappedFile) return false;
  const filePath = path.join(ROOT_DIR, mappedFile);
  if (!fs.existsSync(filePath)) return false;
  res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function logEvent(storeId, cabinId, fromState, toState) {
  const now = Date.now();
  const key = `${storeId}-${cabinId}`;
  let dwellMs = null;
  if (fromState === 'full' && dwellStart[key]) {
    dwellMs = now - dwellStart[key];
    delete dwellStart[key];
  }
  if (toState === 'full') dwellStart[key] = now;
  const event = { ts: now, storeId, cabinId, fromState, toState, dwellMs };
  analyticsLog.push(event);
  if (analyticsLog.length > MAX_EVENTS) analyticsLog.shift();
  return event;
}

function getStoreSummary(storeId, sinceMs = 8 * 60 * 60 * 1000) {
  const since = Date.now() - sinceMs;
  const events = analyticsLog.filter(e => e.storeId === storeId && e.ts >= since);
  const dwellByCabin = {};
  const usageByCabin = {};
  events.forEach(e => {
    if (e.dwellMs !== null) {
      if (!dwellByCabin[e.cabinId]) dwellByCabin[e.cabinId] = [];
      dwellByCabin[e.cabinId].push(e.dwellMs);
    }
    if (e.toState === 'full') usageByCabin[e.cabinId] = (usageByCabin[e.cabinId] || 0) + 1;
  });
  const avgDwell = {};
  Object.keys(dwellByCabin).forEach(id => {
    const arr = dwellByCabin[id];
    avgDwell[id] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 1000);
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
  };
}

function broadcast(storeId, data) {
  if (!wss) return;
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.storeId === storeId) client.send(message);
  });
}

function setCabinState(storeId, cabinId, newState) {
  if (!VALID_STATES.has(newState)) return { ok: false, error: `Invalid state: ${newState}` };
  const store = stores[storeId];
  if (!store) return { ok: false, error: `Unknown store: ${storeId}` };
  const cabin = store.cabins.find(c => c.id === cabinId);
  if (!cabin) return { ok: false, error: `Unknown cabin: ${cabinId}` };
  const oldState = cabin.state;
  if (oldState === newState) return { ok: true, changed: false, cabin };

  cabin.state = newState;
  logEvent(storeId, cabinId, oldState, newState);
  broadcast(storeId, { type: 'update', id: cabinId, state: newState });
  scheduleSave();

  const key = `${storeId}-${cabinId}`;
  if (timers[key]) {
    clearTimeout(timers[key]);
    delete timers[key];
  }
  if (newState === 'clearing') {
    timers[key] = setTimeout(() => setCabinState(storeId, cabinId, 'empty'), CLEARING_TO_EMPTY_MS);
    timers[key].unref();
  }
  return { ok: true, changed: true, cabin };
}

function handleApi(req, res, pathname, parsed) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, uptime: process.uptime(), stores: Object.keys(STORES), persisted: fs.existsSync(DATA_FILE) });
  }
  if (req.method === 'GET' && pathname === '/api/stores') {
    return sendJson(res, 200, Object.keys(STORES).map(id => ({ id, ...STORES[id], currentState: stores[id]?.cabins || [] })));
  }
  const analyticsMatch = pathname.match(/^\/api\/analytics\/(.+)$/);
  if (req.method === 'GET' && analyticsMatch) {
    const storeId = analyticsMatch[1];
    if (!STORES[storeId]) return sendJson(res, 404, { error: 'Store not found' });
    const hours = parseInt(parsed.query.hours, 10) || 8;
    return sendJson(res, 200, getStoreSummary(storeId, hours * 3600000));
  }
  const eventsMatch = pathname.match(/^\/api\/events\/(.+)$/);
  if (req.method === 'GET' && eventsMatch) {
    const storeId = eventsMatch[1];
    return sendJson(res, 200, analyticsLog.filter(e => e.storeId === storeId).slice(-200));
  }
  return false;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (pathname.startsWith('/api/')) {
    const handled = handleApi(req, res, pathname, parsed);
    if (handled !== false) return handled;
    return sendJson(res, 404, { error: 'Not found' });
  }
  if (req.method === 'GET' && serveStatic(req, res, pathname)) return;
  sendJson(res, 200, {
    status: 'Cabin Tracker Server running',
    pages: ['/', '/kiosk', '/simulator', '/dashboard'],
    stores: Object.keys(STORES),
  });
});

wss = new WebSocket.Server({ server });
wss.on('connection', (ws, req) => {
  const params = url.parse(req.url, true).query;
  const storeId = params.store || 'store-001';
  if (!stores[storeId]) return ws.close(1008, 'Unknown store');
  ws.storeId = storeId;
  ws.send(JSON.stringify({ type: 'init', storeId, storeName: STORES[storeId].name, cabins: stores[storeId].cabins }));
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'update') {
        const result = setCabinState(storeId, Number(data.id), data.state);
        if (!result.ok) ws.send(JSON.stringify({ type: 'error', error: result.error }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON message' }));
    }
  });
});

const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
pingInterval.unref();
wss.on('close', () => clearInterval(pingInterval));

function start() {
  server.listen(PORT, () => {
    console.log(`\nCabin Tracker Server — http://localhost:${PORT}`);
    console.log(`Pages: /kiosk /simulator /dashboard`);
    console.log(`API: /api/health /api/stores /api/analytics/:storeId /api/events/:storeId`);
    console.log(`WebSocket: ws://localhost:${PORT}?store=store-001\n`);
  });
}

process.on('SIGINT', () => {
  try { saveStateNow(); } finally { process.exit(0); }
});
process.on('SIGTERM', () => {
  try { saveStateNow(); } finally { process.exit(0); }
});

if (require.main === module) start();

module.exports = { server, stores, analyticsLog, setCabinState, getStoreSummary, loadConfig, saveStateNow, serializeState, VALID_STATES };
