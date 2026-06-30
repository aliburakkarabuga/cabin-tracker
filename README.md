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

- `GET /api/health`
- `GET /api/stores`
- `GET /api/analytics/:storeId?hours=8`
- `GET /api/events/:storeId`

## Roadmap

- [ ] Raspberry Pi integration with real reed switches
- [ ] Staff authentication for simulator panel
- [ ] Deploy server online
- [ ] Buzzer alert when cabin occupied too long
- [ ] Export analytics CSV

## Tech Stack

- **Backend**: Node.js, WebSocket (`ws`)
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Hardware planned**: Raspberry Pi Zero 2W, reed switches

## Author

Ali Burak Karabuga — Computer Engineering Student
