# Cabin Tracker 🚪

Real-time fitting room availability tracker built for Zara-style retail environments. A WebSocket server broadcasts live cabin states to a kiosk screen with no page refresh needed.

## What It Does

```
Reed Switch (door) → Raspberry Pi → WebSocket Server → Kiosk Screen
```

- Door closes → magnetic reed switch triggers → server updates state → kiosk updates instantly
- **Preparing / clearing** state auto-resets to **Available / empty** after 30 seconds
- Includes a simulator panel until hardware sensors are connected
- Includes a dashboard with live store analytics
- Persists cabin state and recent events to `data/state.json`

## Pages

⚠️ **Always open these through the running server, never by double-clicking the file.** They talk to the WebSocket/API on `localhost:3000` — opened as a local `file://` page, there's no host for the WebSocket to connect to and the screen will look frozen (kiosk count stuck on "—", dashboard stuck on "Reconnecting").

After starting the server, open:

- `http://localhost:3000/kiosk` - customer-facing cabin availability display
- `http://localhost:3000/simulator` - staff control panel that simulates sensors
- `http://localhost:3000/dashboard` - analytics/admin dashboard

## States

| Server State | Display Meaning |
|---|---|
| `empty` | Cabin is free |
| `full` | Customer inside |
| `clearing` | Being cleaned, then auto-resets to empty |

## Project Structure

```
cabin-tracker/
├── config.json          # Stores, cabin counts, timers, persistence path
├── data/                # Runtime state, created automatically
├── dashboard.html       # Analytics dashboard
├── kiosk.html           # Customer-facing floor plan display
├── package.json         # npm scripts and dependencies
├── server.js            # HTTP, REST API, WebSocket, persistence
├── simulator.html       # Staff control panel / hardware simulator
└── test/server.test.js  # State machine and config tests
```

## Getting Started

### Prerequisites

- Node.js v18+

### Install

```bash
npm install
```

### Run

```bash
npm start
```

### Test

```bash
npm test
```

## Configuration

Edit `config.json` to change stores, cabin counts, port, timer duration, or persistence path.

```json
{
  "port": 3000,
  "clearingToEmptyMs": 30000,
  "maxEvents": 5000,
  "dataFile": "data/state.json",
  "stores": {
    "store-001": {
      "name": "DeFacto Bağcılar AVM",
      "cabinCount": 13
    }
  }
}
```

Environment overrides:

- `PORT=4000 npm start`
- `CLEARING_TO_EMPTY_MS=10000 npm start`

## API

- `GET /api/health` — server status, uptime, connected clients
- `GET /api/config` — clearing timer duration + store list (used by kiosk/simulator so their countdown never drifts from `config.json`)
- `GET /api/stores`
- `GET /api/analytics/:storeId?hours=8`
- `GET /api/events/:storeId` — JSON events; add `?format=csv` to download a CSV instead

## Roadmap

- [x] Persist cabin state and analytics across restarts (`data/state.json`)
- [x] Buzzer alert when a cabin is occupied too long (dashboard, opt-in via 🔈 Sound)
- [x] Export analytics CSV (dashboard ⬇ Export CSV button, or `GET /api/events/:storeId?format=csv`)
- [ ] Raspberry Pi integration with real reed switches
- [ ] Staff authentication for simulator panel
- [ ] Deploy server online

## Tech Stack

- **Backend**: Node.js, WebSocket (`ws`)
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Hardware planned**: Raspberry Pi Zero 2W, reed switches

## Author

Ali Burak Karabuga — Computer Engineering Student
