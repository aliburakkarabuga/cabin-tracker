const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const fs = require('fs');
const path = require('path');

const STATIC_FILES = {
  '/kiosk.html': 'kiosk.html',
  '/simulator.html': 'simulator.html',
};

const PORT = 3000;
const CLEARING_TO_EMPTY_MS = 30 * 1000;
const CABIN_COUNT = 13;
const MAX_EVENTS = 5000;

const STORES = {
  'store-001': { name: 'DeFacto Bağcılar AVM', cabinCount: 13 },
};

const stores = {};
const timers = {};
const dwellStart = {};
const clearingStart = {};
const analyticsLog = [];

function initStore(storeId) {
  const store = STORES[storeId];
  if (!store) return;
  stores[storeId] = {
    cabins: Array.from({ length: store.cabinCount }, (_, i) => ({
      id: i + 1,
      state: 'empty',
    })),
  };
  console.log(`[${storeId}] Store initialized — ${store.cabinCount} cabins`);
}

Object.keys(STORES).forEach(initStore);

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

function broadcast(storeId, data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.storeId === storeId) {
      client.send(message);
    }
  });
}

function setCabinState(storeId, cabinId, newState) {
  const store = stores[storeId];
  if (!store) return console.warn(`Unknown store: ${storeId}`);

  const cabin = store.cabins.find(c => c.id === cabinId);
  if (!cabin) return console.warn(`Unknown cabin: ${cabinId} in ${storeId}`);

  const oldState = cabin.state;
  if (oldState === newState) return;

  cabin.state = newState;
  console.log(`[${storeId}] Cabin ${cabinId}: ${oldState} → ${newState}`);

  logEvent(storeId, cabinId, oldState, newState);
  broadcast(storeId, { type: 'update', id: cabinId, state: newState });

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
}

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
    const hours = parseInt(parsed.query.hours) || 8;
    return res.end(JSON.stringify(getStoreSummary(storeId, hours * 3600000)));
  }

  const eventsMatch = reqPath.match(/^\/api\/events\/(.+)$/);
  if (req.method === 'GET' && eventsMatch) {
    const storeId = eventsMatch[1];
    const storeEvents = analyticsLog.filter(e => e.storeId === storeId).slice(-200);
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
  }));

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'update') {
        setCabinState(storeId, data.id, data.state);
      }
    } catch (err) {
      console.error(`[${storeId}] Invalid message:`, err.message);
    }
  });

  ws.on('close', () => console.log(`[${storeId}] Client disconnected`));
  ws.on('error', (err) => console.error(`[${storeId}] WS error:`, err.message));
});

const pingInterval = setInterval(() => {
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
  console.log(`\nAPI endpoints:`);
  console.log(`  GET /api/stores`);
  console.log(`  GET /api/analytics/:storeId?hours=8`);
  console.log(`  GET /api/events/:storeId`);
  console.log(`\nWebSocket: ws://localhost:${PORT}?store=store-001\n`);
});