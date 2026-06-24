# Cabin Tracker 🚪

Real-time fitting room availability tracker built for Zara-style retail environments. A WebSocket server broadcasts live cabin states to a kiosk screen — no page refresh needed.

## Demo

| Kiosk Screen | Simulator Panel |
|---|---|
| Zara-style floor plan with live colors | Staff control panel to change cabin states |

## How It Works

```
Reed Switch (door) → Raspberry Pi → WebSocket Server → Kiosk Screen
```

- Door closes → magnetic reed switch triggers → server updates state → kiosk updates instantly
- **Preparing** state auto-resets to **Available** after 30 seconds
- Currently simulated via software — hardware integration coming soon

## States

| State | Color | Meaning |
|---|---|---|
| Available | 🟢 Green | Cabin is free |
| Occupied | ⚫ Dark | Customer inside |
| Preparing | 🔵 Pulsing | Being cleaned — resets in 30s |

## Project Structure

```
cabin-tracker/
├── server.js        # Node.js WebSocket server
├── kiosk.html       # Customer-facing floor plan display
└── simulator.html   # Staff control panel (replaces hardware sensors)
```

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

Then open `kiosk.html` and `simulator.html` in your browser.

## Roadmap

- [ ] Raspberry Pi integration with real reed switches
- [ ] Floor plan from actual store layout
- [ ] Staff authentication for simulator panel
- [ ] Deploy server online (not just localhost)
- [ ] Buzzer alert when cabin occupied too long

## Tech Stack

- **Backend** — Node.js, WebSocket (ws)
- **Frontend** — Vanilla HTML/CSS/JavaScript
- **Hardware (planned)** — Raspberry Pi Zero 2W, reed switches

## Author

Ali Burak Karabuga — Computer Engineering Student
