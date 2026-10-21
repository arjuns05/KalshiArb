# Kalshi / Polymarket candidate scanner

A Next.js dashboard that compares complementary cross-venue ask prices, plus a Gemini research chat that consumes external market-data MCP servers.

Read the [project flow and challenges](CODE_WALKTHROUGH.md) for architecture diagrams, MCP failure handling, current versus proposed retry behavior, and settlement-equivalence matching.

The scanner proposes candidates using title overlap. Settlement equivalence, fees, synchronized prices and fillable quantities remain unverified. See [research and implementation limits](MCP_RESEARCH.md).

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000 and click **Scan markets**. The dashboard calls `GET /api/arb`, which fetches both exchanges and returns fresh candidates. It shows loading, the last completed scan time, and source failures. A failed request preserves the previous results with an explicit notice. Nothing scans automatically on page load or on a timer; only the Next.js process is needed.

PostgreSQL is optional. Configure `DATABASE_URL`, then run `psql "$DATABASE_URL" -f db/schema.sql`. Each `GET /api/arb` scan attempts to save a summary. Chat scans do not save summaries.

## Research chat

Polymarket research uses [PolyTrackers](https://polytrackers.com/polymarket-mcp-server), an independent third-party MCP service. Kalshi MCP research is deferred. The scanner still compares both exchanges through their public APIs.

1. Create a PolyTrackers account, then generate an Agent API Key from Profile with `signals:read` scope. Do not add trading scopes.
2. Add the key and Gemini configuration to your server's `.env`:

```dotenv
GEMINI_API_KEY=...
GEMINI_CHAT_MODEL=gemini-3.8-flash
POLYMARKET_MCP_TOKEN=ptk_...
```

The endpoint defaults to `https://polytrackers.com/api/mcp`; `POLYTRACKERS_API_KEY` is an alias for the token at that endpoint. No credentials are stored in source or sent to the browser. The model default supports function calling per [Google’s model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash); account access must be verified with your own key.

3. Restart the app and verify the connection:

```bash
npm run check:mcp
npm run check:mcp -- --query Bitcoin
```

The first command verifies MCP initialization, tool discovery and the key's research capabilities. The second also calls the provider's market search. Neither calls Gemini or places orders. An authenticated live check cannot run until you supply a provider key.

The provider preset enables market search, market intelligence, batch contract lookups, CLOB quotes, briefings and anomaly context when the server and key allow them. It checks capabilities before research calls, filters tools using tier/scope metadata, and omits public market-trade history on Free accounts. Private account tools, trading, mock writes and scan triggers are excluded. `POLYMARKET_MCP_TOOLS` can narrow the preset, but cannot expand it beyond the research allowlist.

Requests sharing a provider key are serialized within this Node process and spaced by at least 250ms. HTTP 429 responses establish a cooldown from `Retry-After`; authentication and quota failures have safe, actionable errors. Multi-process deployments need a shared rate limiter. Provider tools may also return tool-level quota errors, which the assistant receives as failed evidence rather than invented results.

Users can ask “Find Bitcoin markets on Polymarket and explain their settlement rules.” Gemini chooses MCP tools, reads results and returns an answer with sources and a tool trace. The current-candidate shortcut includes both contract IDs; local scanner/comparison functions can supply Kalshi contract details without claiming a Kalshi MCP connection. General news/web search is not connected.

The client retains optional custom Streamable HTTP support via `POLYMARKET_MCP_URL` and an explicit provider-specific tool list. A custom host does not inherit `POLYTRACKERS_API_KEY`. Leave `KALSHI_MCP_URL` blank to keep Kalshi research disabled; OAuth setup is not implemented. See [research and provider constraints](MCP_RESEARCH.md).

## Code

- `lib/markets.js`: exchange discovery, Polymarket batch books, contract details.
- `lib/arb.js`: shared title matching and gross edge calculations.
- `lib/chat/mcp-client.js`: external MCP connections, discovery and allowed calls.
- `lib/chat/research.js`: Gemini tool loop and evidence trace.
- `lib/investigation.js`: local scan filters, pair evidence and history.
- `src/app/api/chat/route.js`: bounded research requests.
- `src/app/Dashboard.js`: manual REST scanning, scan status, results and research chat.

Run `npm test` and `npm run build`. Tests use fixtures, including actual MCP client protocol exchanges with a mocked remote transport; they require no provider account or database.
