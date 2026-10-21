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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json", ...options.headers },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

export function normalizeKalshi(market) {
  const yesAsk = asNumber(market.yes_ask_dollars);
  const noAsk = asNumber(market.no_ask_dollars);
  if (yesAsk == null || noAsk == null || yesAsk <= 0 || noAsk <= 0 || yesAsk > 1 || noAsk > 1) return null;

  return {
    id: market.ticker,
    venue: "Kalshi",
    title: market.title,
    yesAsk,
    noAsk,
    closeTime: market.close_time || market.expiration_time,
    liquidity: asNumber(market.liquidity_dollars) || 0,
    updatedAt: market.updated_time,
    quoteType: "market_ask_snapshot",
    fetchedAt: new Date().toISOString(),
  };
}

export function normalizePolymarket(market) {
  const outcomes = parseJsonArray(market.outcomes);
  const assetIds = parseJsonArray(market.version === "v2" ? market.positionIds : market.clobTokenIds);
  const yesIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "yes",
  );
  const noIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "no",
  );
  if (outcomes.length !== 2 || yesIndex < 0 || noIndex < 0 || !assetIds[yesIndex] || !assetIds[noIndex]) return null;

  return {
    id: market.conditionId || market.id,
    venue: "Polymarket",
    title: market.question,
    yesAsk: null,
    noAsk: null,
    assetIds: {
      yes: assetIds[yesIndex],
      no: assetIds[noIndex],
    },
    closeTime: market.endDate || market.endDateIso,
    liquidity: asNumber(market.liquidityNum ?? market.liquidity) || 0,
    updatedAt: null,
    quoteType: "orderbook_ask",
  };
}

export function bestAsk(book) {
  const asks = (book?.asks || []).filter((level) => Number(level.size) > 0)
    .map((level) => asNumber(level.price)).filter((price) => price != null && price > 0 && price <= 1);
  return asks.length ? Math.min(...asks) : null;
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

  let polymarket =
    polymarketResult.status === "fulfilled"
      ? polymarketResult.value.map(normalizePolymarket).filter(Boolean)
      : [];

  let bookFailure = null;
  if (polymarket.length) {
    try {
      const books = await fetchJson("https://clob.polymarket.com/books", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(polymarket.flatMap((market) => [market.assetIds.yes, market.assetIds.no])
          .map((id) => ({ token_id: String(id) }))),
      });
      const byId = new Map(books.map((book) => [String(book.asset_id), book]));
      const fetchedAt = new Date().toISOString();
      polymarket = polymarket.map((market) => {
        const yesBook = byId.get(String(market.assetIds.yes));
        const noBook = byId.get(String(market.assetIds.no));
        return { ...market, yesAsk: bestAsk(yesBook), noAsk: bestAsk(noBook), fetchedAt,
          quoteTimestamps: { yes: yesBook?.timestamp ?? null, no: noBook?.timestamp ?? null } };
      });
      if (polymarket.some((market) => market.yesAsk == null || market.noAsk == null)) {
        bookFailure = "Some Polymarket order books have no valid ask; those markets were excluded.";
      }
      polymarket = polymarket.filter((market) => market.yesAsk != null && market.noAsk != null);
    } catch (error) {
      bookFailure = `Polymarket order books unavailable: ${error.message}`;
      polymarket = [];
    }
  }

  return {
    kalshi,
    polymarket,
    failures: {
      kalshi: kalshiResult.status === "rejected" ? kalshiResult.reason.message : null,
      polymarket:
        polymarketResult.status === "rejected" ? polymarketResult.reason.message : bookFailure,
    },
  };
}

// Fetch by identity, independently of the discovery window and available quotes.
export async function getMarketDetails(venue, id) {
  if (!["Kalshi", "Polymarket"].includes(venue)) throw new Error("Unsupported venue");
  const numericPolyId = venue === "Polymarket" && /^\d+$/.test(id);
  const sourceUrl = venue === "Kalshi"
    ? `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(id)}`
    : numericPolyId
      ? `https://gamma-api.polymarket.com/markets/${encodeURIComponent(id)}`
      : `https://gamma-api.polymarket.com/markets?condition_ids=${encodeURIComponent(id)}&closed=any`;
  const data = await fetchJson(sourceUrl);
  const market = venue === "Kalshi" ? data.market : numericPolyId ? (String(data.id) === id ? data : null) : data.find((item) => String(item.conditionId) === id);
  if (!market || (venue === "Kalshi" && market.ticker !== id)) {
    throw new Error(`${venue} market not found: ${id}`);
  }
  return {
    id,
    venue,
    title: market.title || market.question || null,
    closeTime: market.close_time || market.endDate || market.endDateIso || null,
    expirationTime: market.expiration_time || null,
    rules: venue === "Kalshi"
      ? [market.rules_primary, market.rules_secondary].filter(Boolean).join("\n\n") || null
      : market.description || null,
    resolutionSource: market.resolutionSource || null,
    yesSubtitle: market.yes_sub_title || null,
    noSubtitle: market.no_sub_title || null,
    strikeType: market.strike_type || null,
    floorStrike: market.floor_strike ?? null,
    capStrike: market.cap_strike ?? null,
    updatedAt: market.updated_time || market.updatedAt || null,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
  };
}
