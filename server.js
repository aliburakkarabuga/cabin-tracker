const http = require('http');
const WebSocket = require('ws');
const url = require('url');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT = 3000;
const CLEARING_TO_EMPTY_MS = 30 * 1000;
const CABIN_COUNT = 13;
const MAX_EVENTS = 5000; // kaç event tutacağız bellekte

// ─── STORE TANIMI ─────────────────────────────────────────────────────────────
// İleride birden fazla mağaza için buraya ekle
const STORES = {
  'store-001': { name: 'DeFacto Bağcılar AVM', cabinCount: 13 },
  // 'store-002': { name: 'DeFacto Capacity', cabinCount: 10 },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const stores = {};        // stores[storeId] = { cabins: [...] }
const timers = {};        // timers[storeId-cabinId]
const dwellStart = {};    // dwellStart[storeId-cabinId] = timestamp (ne zaman doldu)
const analyticsLog = [];  // tüm event'lar buraya yazılır

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

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
function logEvent(storeId, cabinId, fromState, toState) {
  const now = Date.now();
  const key = `${storeId}-${cabinId}`;

  // dwell time hesapla: kabin "full" iken ne kadar kaldı
  let dwellMs = null;
  if (fromState === 'full' && dwellStart[key]) {
    dwellMs = now - dwellStart[key];
    delete dwellStart[key];
  }
  if (toState === 'full') {
    dwellStart[key] = now;
  }

  const event = {
    ts: now,
    storeId,
    cabinId,
    fromState,
    toState,
    dwellMs,
  };

  analyticsLog.push(event);
  if (analyticsLog.length > MAX_EVENTS) analyticsLog.shift(); // bellek taşmasın

  return event;
}

// Belirli bir store için özet istatistik üret
function getStoreSummary(storeId, sinceMs = 8 * 60 * 60 * 1000) {
  const since = Date.now() - sinceMs;
  const events = analyticsLog.filter(e => e.storeId === storeId && e.ts >= since);

  // Kabin bazında dwell time ortalaması
  const dwellByCabin = {};
  const usageByCabin = {};
  events.forEach(e => {
    if (e.dwellMs !== null) {
      if (!dwellByCabin[e.cabinId]) dwellByCabin[e.cabinId] = [];
      dwellByCabin[e.cabinId].push(e.dwellMs);
    }
    if (e.toState === 'full') {
      usageByCabin[e.cabinId] = (usageByCabin[e.cabinId] || 0) + 1;
    }
  });

  const avgDwell = {};
  Object.keys(dwellByCabin).forEach(id => {
    const arr = dwellByCabin[id];
    avgDwell[id] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 1000); // saniye
  });

  // Saatlik doluluk (son 8 saat, her saat için kaç kez full oldu)
  const hourlyBuckets = {};
  events.filter(e => e.toState === 'full').forEach(e => {
    const hour = new Date(e.ts).getHours();
    hourlyBuckets[hour] = (hourlyBuckets[hour] || 0) + 1;
  });

  // Şu anki doluluk
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

// ─── BROADCAST ────────────────────────────────────────────────────────────────
function broadcast(storeId, data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.storeId === storeId) {
      client.send(message);
    }
  });
}

// ─── STATE MACHINE ────────────────────────────────────────────────────────────
function setCabinState(storeId, cabinId, newState) {
  const store = stores[storeId];
  if (!store) return console.warn(`Unknown store: ${storeId}`);

  const cabin = store.cabins.find(c => c.id === cabinId);
  if (!cabin) return console.warn(`Unknown cabin: ${cabinId} in ${storeId}`);

  const oldState = cabin.state;
  if (oldState === newState) return; // değişim yok, gereksiz broadcast yapma

  cabin.state = newState;
  console.log(`[${storeId}] Cabin ${cabinId}: ${oldState} → ${newState}`);

  logEvent(storeId, cabinId, oldState, newState);
  broadcast(storeId, { type: 'update', id: cabinId, state: newState });

  // clearing timer yönetimi
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

// ─── HTTP SERVER (REST API) ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  // CORS — dashboard başka portta açılabilir
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // GET /api/stores — tüm store listesi
  if (req.method === 'GET' && path === '/api/stores') {
    return res.end(JSON.stringify(Object.keys(STORES).map(id => ({
      id,
      ...STORES[id],
      currentState: stores[id]?.cabins || [],
    }))));
  }

  // GET /api/analytics/:storeId — özet istatistik
  const analyticsMatch = path.match(/^\/api\/analytics\/(.+)$/);
  if (req.method === 'GET' && analyticsMatch) {
    const storeId = analyticsMatch[1];
    if (!STORES[storeId]) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Store not found' }));
    }
    const hours = parseInt(parsed.query.hours) || 8;
    return res.end(JSON.stringify(getStoreSummary(storeId, hours * 3600000)));
  }

  // GET /api/events/:storeId — ham event log (son 200)
  const eventsMatch = path.match(/^\/api\/events\/(.+)$/);
  if (req.method === 'GET' && eventsMatch) {
    const storeId = eventsMatch[1];
    const storeEvents = analyticsLog
      .filter(e => e.storeId === storeId)
      .slice(-200);
    return res.end(JSON.stringify(storeEvents));
  }

  // Default
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'Cabin Tracker Server running', stores: Object.keys(STORES) }));
});

// ─── WEBSOCKET SERVER ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  // URL'den store ID al: ws://localhost:3000?store=store-001
  const params = url.parse(req.url, true).query;
  const storeId = params.store || 'store-001'; // default store

  if (!stores[storeId]) {
    console.warn(`Connection attempt for unknown store: ${storeId}`);
    ws.close(1008, 'Unknown store');
    return;
  }

  ws.storeId = storeId;
  console.log(`[${storeId}] Client connected`);

  // İlk bağlantıda mevcut state'i gönder
  ws.send(JSON.stringify({
    type: 'init',
    storeId,
    storeName: STORES[storeId].name,
    cabins: stores[storeId].cabins,
  }));

  // Ping/pong — bağlantı canlı mı?
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

// Ölü bağlantıları 30 saniyede bir temizle
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

// ─── START ────────────────────────────────────────────────────────────────────
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