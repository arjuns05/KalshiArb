const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const KALSHI_URL =
  "https://external-api.kalshi.com/trade-api/v2/markets?status=open&limit=200";
const POLYMARKET_URL =
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200";
const POLYMARKET_WS_URL =
  process.env.POLYMARKET_WS_URL ||
  "wss://ws-subscriptions-clob.polymarket.com/ws/market";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) return;

      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    });
}

loadEnvFile();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const wsPort = Number(process.env.WS_PORT || 4000);
const refreshMs = Number(process.env.MARKET_REFRESH_MS || 300000);

const state = {
  kalshi: [],
  polymarket: [],
  failures: { kalshi: null, polymarket: null },
  source: "starting",
  lastPolymarketEventAt: null,
  tokenLookup: new Map(),
};

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    source: state.source,
    kalshiMarkets: state.kalshi.length,
    polymarketMarkets: state.polymarket.length,
    lastPolymarketEventAt: state.lastPolymarketEventAt,
  });
});

function asNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

function tokenize(text) {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "any",
    "be",
    "before",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "over",
    "the",
    "to",
    "will",
    "win",
    "with",
  ]);

  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function similarity(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function normalizeKalshi(market) {
  const yesAsk = asNumber(market.yes_ask_dollars);
  const noAsk = asNumber(market.no_ask_dollars);
  if (yesAsk == null || noAsk == null || yesAsk <= 0 || noAsk <= 0) return null;

  return {
    id: market.ticker,
    venue: "Kalshi",
    title: market.title,
    yesAsk,
    noAsk,
    closeTime: market.close_time || market.expiration_time,
    liquidity: asNumber(market.liquidity_dollars) || 0,
    updatedAt: market.updated_time,
  };
}

function normalizePolymarket(market) {
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices).map(asNumber);
  const assetIds = parseJsonArray(market.clobTokenIds);
  const yesIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "yes",
  );
  const noIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "no",
  );
  const yesAsk = yesIndex >= 0 ? prices[yesIndex] : asNumber(market.bestAsk);
  const noAsk = noIndex >= 0 ? prices[noIndex] : yesAsk == null ? null : 1 - yesAsk;

  if (yesAsk == null || noAsk == null || yesAsk <= 0 || noAsk <= 0) return null;

  return {
    id: market.conditionId || market.id,
    venue: "Polymarket",
    title: market.question,
    yesAsk,
    noAsk,
    assetIds: {
      yes: yesIndex >= 0 ? assetIds[yesIndex] : null,
      no: noIndex >= 0 ? assetIds[noIndex] : null,
    },
    closeTime: market.endDate || market.endDateIso,
    liquidity: asNumber(market.liquidityNum ?? market.liquidity) || 0,
    updatedAt: market.updatedAt,
  };
}

async function loadSnapshots() {
  const [kalshiResult, polymarketResult] = await Promise.allSettled([
    fetchJson(KALSHI_URL),
    fetchJson(POLYMARKET_URL),
  ]);

  if (kalshiResult.status === "fulfilled") {
    state.kalshi = (kalshiResult.value.markets || [])
      .map(normalizeKalshi)
      .filter(Boolean);
    state.failures.kalshi = null;
  } else {
    state.failures.kalshi = kalshiResult.reason.message;
  }

  if (polymarketResult.status === "fulfilled") {
    state.polymarket = polymarketResult.value.map(normalizePolymarket).filter(Boolean);
    state.failures.polymarket = null;
    rebuildTokenLookup();
  } else {
    state.failures.polymarket = polymarketResult.reason.message;
  }

  state.source = "snapshot";
}

function rebuildTokenLookup() {
  state.tokenLookup = new Map();

  state.polymarket.forEach((market, marketIndex) => {
    if (market.assetIds?.yes) {
      state.tokenLookup.set(String(market.assetIds.yes), { marketIndex, side: "yes" });
    }

    if (market.assetIds?.no) {
      state.tokenLookup.set(String(market.assetIds.no), { marketIndex, side: "no" });
    }
  });
}

function buildOpportunity(yesMarket, yesSide, yesPrice, noMarket, noSide, noPrice, score) {
  const cost = yesPrice + noPrice;

  return {
    title: yesMarket.title,
    closeTime: yesMarket.closeTime || noMarket.closeTime,
    score,
    edge: 1 - cost,
    cost,
    markets: [
      {
        venue: yesMarket.venue,
        side: yesSide,
        price: yesPrice,
        color: yesMarket.venue === "Kalshi" ? "blue" : "purple",
      },
      {
        venue: noMarket.venue,
        side: noSide,
        price: noPrice,
        color: noMarket.venue === "Kalshi" ? "blue" : "purple",
      },
    ],
  };
}

function computeArbitrage() {
  const matches = [];

  state.kalshi.forEach((kalshiMarket) => {
    state.polymarket.forEach((polymarketMarket) => {
      const score = similarity(kalshiMarket.title, polymarketMarket.title);
      if (score < 0.36) return;

      matches.push(
        buildOpportunity(
          kalshiMarket,
          "Yes",
          kalshiMarket.yesAsk,
          polymarketMarket,
          "No",
          polymarketMarket.noAsk,
          score,
        ),
      );

      matches.push(
        buildOpportunity(
          polymarketMarket,
          "Yes",
          polymarketMarket.yesAsk,
          kalshiMarket,
          "No",
          kalshiMarket.noAsk,
          score,
        ),
      );
    });
  });

  matches.sort((left, right) => right.edge - left.edge);

  return {
    best: matches[0] || null,
    opportunities: matches,
    failures: state.failures,
    source: state.source,
    lastPolymarketEventAt: state.lastPolymarketEventAt,
    stats: {
      kalshi: state.kalshi.length,
      polymarket: state.polymarket.length,
      matches: Math.floor(matches.length / 2),
      opportunities: matches.filter((match) => match.edge > 0).length,
    },
  };
}

function makeUpdate(result) {
  return JSON.stringify({
    type: "arb_update",
    best: result.best,
    stats: result.stats,
    failures: result.failures,
    source: result.source,
    lastPolymarketEventAt: result.lastPolymarketEventAt,
    at: new Date().toISOString(),
  });
}

function broadcast(result = computeArbitrage()) {
  const message = makeUpdate(result);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

function bestAskFromBook(asks) {
  if (!Array.isArray(asks) || !asks.length) return null;

  return asks.reduce((best, level) => {
    const price = asNumber(level.price);
    if (price == null) return best;
    return best == null || price < best ? price : best;
  }, null);
}

function updatePolymarketPrice(tokenId, askPrice) {
  if (askPrice == null || askPrice <= 0) return false;

  const match = state.tokenLookup.get(String(tokenId));
  if (!match) return false;

  const market = state.polymarket[match.marketIndex];
  if (!market) return false;

  if (match.side === "yes") market.yesAsk = askPrice;
  if (match.side === "no") market.noAsk = askPrice;
  market.updatedAt = new Date().toISOString();
  state.source = "polymarket_ws";
  state.lastPolymarketEventAt = market.updatedAt;
  return true;
}

function handlePolymarketMessage(raw) {
  if (raw === "PONG") return;

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  const events = Array.isArray(message) ? message : [message];
  let changed = false;

  events.forEach((event) => {
    const payload = event.payload || event;

    if (event.type === "book") {
      const tokenId = payload.tokenId || payload.token_id;
      changed = updatePolymarketPrice(tokenId, bestAskFromBook(payload.asks)) || changed;
    }

    if (event.type === "best_bid_ask") {
      const tokenId = payload.tokenId || payload.token_id;
      changed = updatePolymarketPrice(tokenId, asNumber(payload.bestAsk)) || changed;
    }

    if (event.type === "price_change") {
      const priceChanges = payload.priceChanges || payload.price_changes || [];
      priceChanges.forEach((change) => {
        const tokenId = change.tokenId || change.token_id;
        changed = updatePolymarketPrice(tokenId, asNumber(change.bestAsk)) || changed;
      });
    }
  });

  if (changed) broadcast();
}

function connectPolymarketStream() {
  const tokenIds = [...state.tokenLookup.keys()].slice(
    0,
    Number(process.env.POLYMARKET_WS_TOKEN_LIMIT || 200),
  );

  if (!tokenIds.length) {
    console.log("no Polymarket token ids available for websocket subscription");
    return;
  }

  const socket = new WebSocket(POLYMARKET_WS_URL);
  let pingTimer;

  socket.on("open", () => {
    console.log(`connected to Polymarket websocket with ${tokenIds.length} token ids`);
    socket.send(
      JSON.stringify({
        assets_ids: tokenIds,
        type: "market",
        custom_feature_enabled: true,
      }),
    );

    pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send("PING");
    }, 10000);
  });

  socket.on("message", (data) => {
    handlePolymarketMessage(String(data));
  });

  socket.on("close", () => {
    clearInterval(pingTimer);
    console.log("Polymarket websocket closed, reconnecting soon");
    setTimeout(connectPolymarketStream, 5000);
  });

  socket.on("error", (error) => {
    console.error("Polymarket websocket error:", error.message);
    socket.close();
  });
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "connected" }));
  socket.send(makeUpdate(computeArbitrage()));
});

setInterval(async () => {
  try {
    await loadSnapshots();
    broadcast();
  } catch (error) {
    console.error("snapshot refresh failed:", error.message);
  }
}, refreshMs);

async function start() {
  await loadSnapshots();
  connectPolymarketStream();

  server.listen(wsPort, () => {
    console.log(`dashboard websocket listening on ${wsPort}`);
    console.log(`Polymarket stream: ${POLYMARKET_WS_URL}`);
    console.log("Kalshi websocket not enabled: current Kalshi docs require auth");
  });
}

function handleServerError(error) {
  if (error.code === "EADDRINUSE") {
    console.error(
      `port ${wsPort} is already in use. Set WS_PORT and NEXT_PUBLIC_WS_PORT to another port.`,
    );
    console.error("example: NEXT_PUBLIC_WS_PORT=4001 npm run dev");
    console.error("example: WS_PORT=4001 npm run realtime");
    process.exit(1);
  }

  throw error;
}

server.on("error", handleServerError);
wss.on("error", handleServerError);

start().catch((error) => {
  console.error("realtime server failed to start:", error.message);
  process.exit(1);
});
