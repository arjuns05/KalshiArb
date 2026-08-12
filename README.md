# Prediction Market Arbitrage Tool

Small Next.js app that scans public Kalshi and Polymarket markets and looks for
simple Yes/No arbitrage pairs.

This is intentionally built without Prisma. The database code is just `pg` plus
plain SQL in `db/schema.sql`.

## Stack

- Next.js dashboard
- API routes for scans and MCP-style enrichment
- Express + WebSocket side server for realtime pushes
- PostgreSQL with simple SQL
- Optional Google Gemini summary in `/api/mcp`
- Codex-assisted cleanup, April 2026 project framing

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

To create the database table:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

The app still works without `DATABASE_URL`; it just skips saving scan history.

## Realtime server

Run Next first, then start the WebSocket broadcaster:

```bash
npm run realtime
```

It listens on `ws://localhost:4000` and broadcasts the latest scan every 30
seconds.

## MCP endpoint

`POST /api/mcp`

```json
{
  "question": "Why is this an arb?"
}
```

If `GEMINI_API_KEY` is set, the endpoint asks Gemini for a short explanation. If
not, it returns a basic local explanation.
