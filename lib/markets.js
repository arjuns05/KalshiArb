const KALSHI_URL =
  "https://external-api.kalshi.com/trade-api/v2/markets?status=open&limit=200";
const POLYMARKET_URL =
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200";

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
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
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
    closeTime: market.endDate || market.endDateIso,
    liquidity: asNumber(market.liquidityNum ?? market.liquidity) || 0,
    updatedAt: market.updatedAt,
  };
}

export async function getMarkets() {
  const [kalshiResult, polymarketResult] = await Promise.allSettled([
    fetchJson(KALSHI_URL),
    fetchJson(POLYMARKET_URL),
  ]);

  const kalshi =
    kalshiResult.status === "fulfilled"
      ? (kalshiResult.value.markets || []).map(normalizeKalshi).filter(Boolean)
      : [];

  const polymarket =
    polymarketResult.status === "fulfilled"
      ? polymarketResult.value.map(normalizePolymarket).filter(Boolean)
      : [];

  return {
    kalshi,
    polymarket,
    failures: {
      kalshi: kalshiResult.status === "rejected" ? kalshiResult.reason.message : null,
      polymarket:
        polymarketResult.status === "rejected" ? polymarketResult.reason.message : null,
    },
  };
}
