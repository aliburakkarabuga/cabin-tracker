# Cabin Tracker 🚪

Real-time fitting room occupancy monitoring system built for retail chains. A WebSocket server broadcasts live cabin states to a customer-facing kiosk and a manager dashboard — no page refresh needed.

Originally built for Zara-style environments, now architected for multi-store retail chains (DeFacto, LC Waikiki, Mango, Koton etc.)

## Screens

| Kiosk | Dashboard | Simulator |
|---|---|---|
| Customer-facing floor plan with live colors | Manager analytics — traffic, dwell time, alerts | Hardware simulator / staff control panel |

## How It Works

```
Reed Switch (door) → ESP32 → WebSocket Server → Kiosk + Dashboard
```

- Door closes → reed switch triggers → server updates state → all clients update instantly
- **Preparing** state auto-resets to **Available** after 30 seconds
- No human intervention needed — fully autonomous once hardware is connected
- Currently simulated via software — ESP32 hardware integration in progress

## States

| State | Color | Meaning |
|---|---|---|
| Available | 🟢 Green | Cabin is free |
| Occupied | ⚫ Dark | Customer inside |
| Preparing | 🟡 Pulsing | Being cleaned — auto-resets in 30s |

## Project Structure

```
cabin-tracker/
├── server.js        # Node.js WebSocket + REST API server
├── kiosk.html       # Customer-facing floor plan display
├── dashboard.html   # Manager analytics dashboard
└── simulator.html   # Hardware simulator / control panel
```

## Features

### Server
- Multi-store support — each store has its own WebSocket channel
- REST API — `/api/stores`, `/api/analytics/:storeId`, `/api/events/:storeId`
- Analytics engine — dwell time tracking, hourly traffic, per-cabin usage
- Ping/pong heartbeat — dead connections cleaned up automatically
- Auto-clearing timer — preparing state resets to available after 30s

### Kiosk
- Live floor plan with color-coded cabin states
- Auto-reconnect with exponential backoff
- Store name pulled from server
- Zero available rooms → count turns red

### Dashboard
- Live occupancy stats — free / occupied / clearing
- Hourly traffic chart — which hours are busiest
- Per-cabin usage chart — which cabins get the most use
- Average dwell time per cabin
- Long-stay alerts — warns when a cabin has been occupied 15+ min, critical at 30+ min
- 4h / 8h / 24h time range selector

### Simulator
- Store selector — switch between stores
- Bulk actions — All Empty / All Full / All Clearing / Randomize
- Keyboard shortcuts — select a cabin, press E / F / C
- Clearing countdown timer per cabin

## Getting Started

### Prerequisites
- Node.js v18+

### Installation

```bash
git clone https://github.com/aliburakkarabuga/cabin-tracker
cd cabin-tracker
npm install ws
```

### Run

```bash
node server.js
```

Then open in your browser:
- `kiosk.html` — customer display
- `dashboard.html` — manager analytics
- `simulator.html` — control panel / hardware simulator

### Multi-store setup

Edit the `STORES` object in `server.js`:

```js
const STORES = {
  'store-001': { name: 'DeFacto Bağcılar AVM', cabinCount: 13 },
  'store-002': { name: 'DeFacto Capacity',     cabinCount: 10 },
};
```

Then open kiosk/dashboard with `?store=store-002` URL parameter.

## Roadmap

- [ ] ESP32 integration with real reed switches
- [ ] Floor plan editor — upload actual store layout
- [ ] Deploy server online (Railway / Render)
- [ ] Staff authentication for simulator panel
- [ ] Buzzer / push alert when cabin occupied too long
- [ ] Weekly PDF report export from dashboard

## Tech Stack

- **Backend** — Node.js, WebSocket (ws), HTTP REST API
- **Frontend** — Vanilla HTML/CSS/JavaScript, Canvas charts
- **Hardware (in progress)** — ESP32, reed switches

## Author

Ali Burak Karabuga — Computer Engineering Student
