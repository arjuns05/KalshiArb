# Prediction Market Arbitrage Tool

Small Next.js app that scans public Kalshi and Polymarket markets and looks for
simple Yes/No arbitrage pairs.


## Stack

- Next.js dashboard
- API routes for scans and MCP-style enrichment
- Express + WebSocket side server that pushes scan updates into the UI
- PostgreSQL with simple SQL
- Optional Google Gemini summary in `/api/mcp`

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

To create the database table:

bash:
psql "$DATABASE_URL" -f db/schema.sql


The app still works without `DATABASE_URL`; it just skips saving scan history.

## Realtime server

Run Next first, then start the WebSocket broadcaster in a second terminal:

bash:
npm run realtime


The dashboard connects to `ws://localhost:4000`, gets one scan right after the
socket opens, and then receives pushed updates from the backend.

The backend now uses Polymarket's public market WebSocket for price updates. It
still loads REST snapshots for initial market discovery and for Kalshi, because
Kalshi's current WebSocket docs require authentication for the connection.

If you use a different socket URL, set:

```bash
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

If port `4000` is already taken, use a matching WebSocket port in both places:

```bash
NEXT_PUBLIC_WS_PORT=4001 npm run dev
WS_PORT=4001 npm run realtime
```

## MCP server endpoint

`POST /api/mcp`

The app exposes one MCP-style HTTP JSON-RPC endpoint with one tool:

- `market_context`: fetches the latest scan and answers using that scan as
  context.

List tools:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call the tool:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "market_context",
      "arguments": {
        "question": "What is the best arbitrage opportunity?",
        "includeRawScan": false
      }
    }
  }'
```

For quick manual testing, the endpoint also accepts:

```json
{
  "question": "Why is this an arb?"
}
```


