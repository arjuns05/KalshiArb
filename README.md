# kalshi-sports-arb

A Next.js + Prisma app for finding two-outcome arbitrage between **Kalshi** and **Polymarket**.

The app:
- Polls live markets from Kalshi and Polymarket
- Normalizes them into canonical two-outcome markets (`YES` / `NO`)
- Stores market snapshots/quotes in SQLite via Prisma
- Lets you select a market and run an arbitrage calculation
- Shows implied-probability sum, stake split, and guaranteed ROI/profit (if `sumImpliedProb < 1`)

## Requirements

- Node.js 18+
- npm
- Internet access to Kalshi + Polymarket public APIs

## Tech Stack

- Next.js 14 (App Router)
- Prisma + SQLite
- React

## Environment Variables

Create a `.env` file in project root.

```env
# Database
DATABASE_URL="file:./dev.db"

# Kalshi
KALSHI_API_BASE="https://api.elections.kalshi.com/trade-api/v2"
KALSHI_MARKET_LIMIT="200"
KALSHI_MAX_PAGES="5"

# Polymarket
POLYMARKET_GAMMA_BASE="https://gamma-api.polymarket.com"
POLYMARKET_MARKET_LIMIT="200"
POLYMARKET_MAX_PAGES="5"

# Polling service
POLL_ENABLED="true"
POLL_INTERVAL_MS="60000"
POLL_ON_STARTUP="true"
```

Notes:
- Kalshi public market reads are used from `KALSHI_API_BASE`.
- Polymarket public market reads are used from `POLYMARKET_GAMMA_BASE`.

## Setup

```bash
npm install
npm run prisma:migrate
```

## Run (Development)

```bash
npm run dev
```

Open:
- `http://localhost:3000`

Then:
1. Click **Fetch Live Markets** to ingest current data.
2. Select a canonical market.
3. Enter budget/slippage and click **Recalculate**.

## API Endpoints

- `POST /api/ingest` - Fetch + ingest from connectors now
- `GET /api/canonical-markets` - List canonical markets for UI selection
- `POST /api/arb` - Run arbitrage calculation for a selected market
- `GET /api/polling/status` - Poller status
- `POST /api/polling/status` - Trigger manual poll
- `GET /api/polling/stream` - SSE stream for live poll updates

## Build / Production

```bash
npm run build
npm run start
```

## Current Scope / Constraints

- Two-outcome markets only (`marketType = two_way`)
- Canonicalization is matchup-based and may skip markets that cannot be confidently parsed
- Liquidity/limits/slippage are simplified in this MVP

## Troubleshooting

- No markets appearing:
  - Confirm `ODDS_API_KEY` is valid
  - Click **Fetch Live Markets**
  - Check server logs for connector errors
- Polling appears disabled:
  - Set `POLL_ENABLED="true"`
- DB issues:
  - Re-run `npm run prisma:migrate`
