import { marketFromTeams } from "./shared.js";

const KALSHI_API_BASE = process.env.KALSHI_API_BASE || "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_MARKET_LIMIT = parseInt(process.env.KALSHI_MARKET_LIMIT || "200", 10);
const KALSHI_MAX_PAGES = parseInt(process.env.KALSHI_MAX_PAGES || "5", 10);

function parseTeamsFromKalshiMarket(market) {
  function isGenericBinaryLabel(value) {
    const v = String(value || "").trim().toLowerCase();
    return v === "yes" || v === "no" || v === "true" || v === "false";
  }

  function isLikelyTeamLabel(value) {
    const v = String(value || "").trim();
    if (!v) return false;
    if (isGenericBinaryLabel(v)) return false;
    if (v.length > 40) return false;
    if (v.includes(",")) return false;
    if (/(over|under|between|more than|less than|wins by)/i.test(v)) return false;
    return true;
  }

  const yesSubtitle = String(market?.yes_sub_title || market?.yes_subtitle || "").trim();
  const noSubtitle = String(market?.no_sub_title || market?.no_subtitle || "").trim();
  if (
    yesSubtitle &&
    noSubtitle &&
    isLikelyTeamLabel(yesSubtitle) &&
    isLikelyTeamLabel(noSubtitle)
  ) {
    return [yesSubtitle, noSubtitle];
  }

  const subtitle = String(market?.subtitle || "").trim();
  const subtitleMatch = subtitle.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (
    subtitleMatch &&
    isLikelyTeamLabel(subtitleMatch[1]) &&
    isLikelyTeamLabel(subtitleMatch[2])
  ) {
    return [subtitleMatch[1].trim(), subtitleMatch[2].trim()];
  }

  const title = String(market?.title || "").trim();
  const titleMatch = title.match(/^Will\s+(.+?)\s+(?:beat|defeat)\s+(.+?)\??$/i);
  if (
    titleMatch &&
    isLikelyTeamLabel(titleMatch[1]) &&
    isLikelyTeamLabel(titleMatch[2])
  ) {
    return [titleMatch[1].trim(), titleMatch[2].trim()];
  }

  return null;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeGenericCanonicalFromKalshi(market) {
  const question = cleanText(market?.title || "");
  if (!question) return null;
  if (question.length < 8) return null;
  if (question.includes(",") && question.split(",").length > 3) return null;

  return {
    eventName: question,
    marketName: "Binary Outcome"
  };
}

function parseProbability(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  // Kalshi values may come in dollars (0..1) or cents (1..99)
  const p = n > 1 ? n / 100 : n;
  if (!(p > 0 && p < 1)) return null;
  return p;
}

function toDecimalOdds(probability) {
  if (!(probability > 0 && probability < 1)) return null;
  return Number((1 / probability).toFixed(6));
}

function firstValidProbability(values) {
  for (const v of values) {
    const p = parseProbability(v);
    if (p) return p;
  }
  return null;
}

function resolveKalshiOdds(market) {
  const yesProb = firstValidProbability([
    market?.yes_ask_dollars,
    market?.yes_bid_dollars,
    market?.yes_price_dollars,
    market?.yes_last_price_dollars,
    market?.yes_ask,
    market?.yes_bid,
    market?.yes_price,
    market?.yes_last_price
  ]);

  const noProb = firstValidProbability([
    market?.no_ask_dollars,
    market?.no_bid_dollars,
    market?.no_price_dollars,
    market?.no_last_price_dollars,
    market?.no_ask,
    market?.no_bid,
    market?.no_price,
    market?.no_last_price
  ]);

  const yes = yesProb ?? (noProb ? 1 - noProb : null);
  const no = noProb ?? (yesProb ? 1 - yesProb : null);
  if (!(yes > 0 && yes < 1 && no > 0 && no < 1)) return null;

  const oddsYes = toDecimalOdds(yes);
  const oddsNo = toDecimalOdds(no);
  if (!(oddsYes && oddsNo)) return null;

  return { oddsYes, oddsNo };
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
  let skippedNoCanonical = 0;
  let skippedNoOdds = 0;
  let skippedNoExternalId = 0;

  for (const market of pages) {
    const teams = parseTeamsFromKalshiMarket(market);
    const canonical = teams
      ? marketFromTeams(teams[0], teams[1])
      : makeGenericCanonicalFromKalshi(market);
    if (!canonical) continue;

    const resolvedOdds = resolveKalshiOdds(market);
    if (!resolvedOdds) {
      skippedNoOdds++;
      continue;
    }

    const externalId = String(market?.ticker || "").trim();
    if (!externalId) {
      skippedNoExternalId++;
      continue;
    }

    let oddsYes = resolvedOdds.oddsYes;
    let oddsNo = resolvedOdds.oddsNo;

    if (teams && canonical.yesTeam) {
      const yesMarketTeam = String(market?.yes_sub_title || market?.yes_subtitle || teams[0]).trim();
      const yesMapsToCanonicalYes =
        yesMarketTeam.localeCompare(canonical.yesTeam, undefined, { sensitivity: "base" }) === 0;
      oddsYes = yesMapsToCanonicalYes ? resolvedOdds.oddsYes : resolvedOdds.oddsNo;
      oddsNo = yesMapsToCanonicalYes ? resolvedOdds.oddsNo : resolvedOdds.oddsYes;
    }

    normalized.push({
      source: "kalshi",
      bookName: "Kalshi",
      externalEventId: String(market?.event_ticker || ""),
      externalId,
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

  skippedNoCanonical = pages.length - normalized.length - skippedNoOdds - skippedNoExternalId;
  console.log(
    `[Kalshi] fetched=${pages.length} normalized=${normalized.length} ` +
      `skipped_no_canonical=${Math.max(0, skippedNoCanonical)} ` +
      `skipped_no_odds=${skippedNoOdds} skipped_no_external_id=${skippedNoExternalId}`
  );

  return normalized;
}
