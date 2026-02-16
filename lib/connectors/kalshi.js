import { kalshiPriceToDecimalOdds, marketFromTeams } from "./shared.js";

const KALSHI_API_BASE = process.env.KALSHI_API_BASE || "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_MARKET_LIMIT = parseInt(process.env.KALSHI_MARKET_LIMIT || "200", 10);
const KALSHI_MAX_PAGES = parseInt(process.env.KALSHI_MAX_PAGES || "5", 10);

function parseTeamsFromKalshiMarket(market) {
  const yesSubtitle = String(market?.yes_sub_title || market?.yes_subtitle || "").trim();
  const noSubtitle = String(market?.no_sub_title || market?.no_subtitle || "").trim();
  if (yesSubtitle && noSubtitle) {
    return [yesSubtitle, noSubtitle];
  }

  const subtitle = String(market?.subtitle || "").trim();
  const subtitleMatch = subtitle.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (subtitleMatch) {
    return [subtitleMatch[1].trim(), subtitleMatch[2].trim()];
  }

  const title = String(market?.title || "").trim();
  const titleMatch = title.match(/^Will\s+(.+?)\s+(?:beat|defeat)\s+(.+?)\??$/i);
  if (titleMatch) {
    return [titleMatch[1].trim(), titleMatch[2].trim()];
  }

  return null;
}

async function fetchMarketPage(cursor) {
  const params = new URLSearchParams({
    status: "open",
    limit: String(KALSHI_MARKET_LIMIT)
  });
  if (cursor) params.set("cursor", cursor);

  const url = `${KALSHI_API_BASE}/markets?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Kalshi markets request failed (${res.status})`);
  }

  const body = await res.json();
  return {
    markets: Array.isArray(body?.markets) ? body.markets : [],
    cursor: body?.cursor || null
  };
}

export async function fetchKalshiMarkets() {
  const pages = [];
  let cursor = null;

  for (let i = 0; i < KALSHI_MAX_PAGES; i++) {
    const page = await fetchMarketPage(cursor);
    pages.push(...page.markets);
    if (!page.cursor) break;
    cursor = page.cursor;
  }

  const normalized = [];

  for (const market of pages) {
    const teams = parseTeamsFromKalshiMarket(market);
    if (!teams) continue;

    const canonical = marketFromTeams(teams[0], teams[1]);
    if (!canonical) continue;

    const yesRaw =
      market?.yes_ask_dollars ??
      market?.yes_bid_dollars ??
      market?.yes_ask ??
      market?.yes_bid;
    const noRaw =
      market?.no_ask_dollars ??
      market?.no_bid_dollars ??
      market?.no_ask ??
      market?.no_bid;

    const yesMarketTeam = String(market?.yes_sub_title || market?.yes_subtitle || teams[0]).trim();
    const yesOddsRaw = kalshiPriceToDecimalOdds(yesRaw);
    const noOddsRaw = kalshiPriceToDecimalOdds(noRaw);
    if (!(yesOddsRaw && noOddsRaw)) continue;

    const yesMapsToCanonicalYes =
      yesMarketTeam.localeCompare(canonical.yesTeam, undefined, { sensitivity: "base" }) === 0;

    const oddsYes = yesMapsToCanonicalYes ? yesOddsRaw : noOddsRaw;
    const oddsNo = yesMapsToCanonicalYes ? noOddsRaw : yesOddsRaw;

    normalized.push({
      source: "kalshi",
      bookName: "Kalshi",
      externalEventId: String(market?.event_ticker || ""),
      externalId: String(market?.ticker || ""),
      eventName: canonical.eventName,
      startTime: market?.close_time || null,
      marketName: canonical.marketName,
      marketType: "two_way",
      outcomes: [
        { name: "YES", decimalOdds: oddsYes },
        { name: "NO", decimalOdds: oddsNo }
      ]
    });
  }

  return normalized;
}
