import { marketFromTeams } from "./shared.js";

const POLYMARKET_GAMMA_BASE =
  process.env.POLYMARKET_GAMMA_BASE || "https://gamma-api.polymarket.com";
const POLYMARKET_MARKET_LIMIT = parseInt(process.env.POLYMARKET_MARKET_LIMIT || "200", 10);
const POLYMARKET_MAX_PAGES = parseInt(process.env.POLYMARKET_MAX_PAGES || "5", 10);

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeTeamName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[?.!,]+$/g, "")
    .trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTeamsFromText(text) {
  const clean = normalizeTeamName(text);
  if (!clean) return null;

  const vsMatch = clean.match(/^(.+?)\s+vs\.?\s+(.+?)$/i);
  if (vsMatch) {
    return [normalizeTeamName(vsMatch[1]), normalizeTeamName(vsMatch[2])];
  }

  const atMatch = clean.match(/^(.+?)\s+at\s+(.+?)$/i);
  if (atMatch) {
    return [normalizeTeamName(atMatch[1]), normalizeTeamName(atMatch[2])];
  }

  const winnerMatch = clean.match(/winner\s*[:\-]?\s*(.+?)\s+vs\.?\s+(.+?)$/i);
  if (winnerMatch) {
    return [normalizeTeamName(winnerMatch[1]), normalizeTeamName(winnerMatch[2])];
  }

  return null;
}

function parseDirectionalYesNoTeams(text) {
  const clean = normalizeTeamName(text);
  if (!clean) return null;

  const beatMatch = clean.match(/^will\s+(.+?)\s+(?:beat|defeat)\s+(.+?)\??$/i);
  if (beatMatch) {
    return {
      yesTeam: normalizeTeamName(beatMatch[1]),
      noTeam: normalizeTeamName(beatMatch[2])
    };
  }

  return null;
}

function makeGenericCanonicalFromQuestion(question) {
  const cleaned = cleanText(question);
  if (!cleaned) return null;
  return {
    eventName: cleaned,
    marketName: "Binary Outcome"
  };
}

function toDecimalFromProbability(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const probability = n > 1 ? n / 100 : n;
  if (!(probability > 0 && probability < 1)) return null;

  return Number((1 / probability).toFixed(6));
}

function namesEqual(a, b) {
  return normalizeTeamName(a).localeCompare(normalizeTeamName(b), undefined, {
    sensitivity: "base"
  }) === 0;
}

function parseOutcomesAndPrices(market) {
  const outcomes = parseJsonArray(market?.outcomes).map((o) => normalizeTeamName(o));
  const prices = parseJsonArray(market?.outcomePrices);
  if (outcomes.length === 0 || prices.length === 0 || outcomes.length !== prices.length) {
    return [];
  }

  return outcomes
    .map((name, idx) => ({
      name,
      decimalOdds: toDecimalFromProbability(prices[idx])
    }))
    .filter((o) => o.name && o.decimalOdds);
}

async function fetchMarketPage(offset) {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    archived: "false",
    limit: String(POLYMARKET_MARKET_LIMIT),
    offset: String(offset)
  });

  const url = `${POLYMARKET_GAMMA_BASE}/markets?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Polymarket markets request failed (${res.status})`);
  }

  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.markets)) return body.markets;
  return [];
}

export async function fetchPolymarketMarkets() {
  const pages = [];
  for (let page = 0; page < POLYMARKET_MAX_PAGES; page++) {
    const offset = page * POLYMARKET_MARKET_LIMIT;
    const markets = await fetchMarketPage(offset);
    pages.push(...markets);
    if (markets.length < POLYMARKET_MARKET_LIMIT) break;
  }

  const normalized = [];
  const seenExternalIds = new Set();
  let skippedNoCanonical = 0;
  let skippedNoOutcomes = 0;
  let skippedNoOdds = 0;
  let skippedNoExternalId = 0;

  for (const market of pages) {
    const question = String(market?.question || market?.title || market?.description || "").trim();
    const teams = parseTeamsFromText(question);
    const canonical = teams
      ? marketFromTeams(teams[0], teams[1])
      : makeGenericCanonicalFromQuestion(question);
    if (!canonical) continue;

    const outcomes = parseOutcomesAndPrices(market);
    if (outcomes.length < 2) {
      skippedNoOutcomes++;
      continue;
    }

    let oddsYes = null;
    let oddsNo = null;

    if (teams && canonical.yesTeam && canonical.noTeam) {
      const teamYes = outcomes.find((o) => namesEqual(o.name, canonical.yesTeam));
      const teamNo = outcomes.find((o) => namesEqual(o.name, canonical.noTeam));
      if (teamYes && teamNo) {
        oddsYes = teamYes.decimalOdds;
        oddsNo = teamNo.decimalOdds;
      }
    }

    if (!(oddsYes && oddsNo)) {
      const yesOutcome = outcomes.find((o) => namesEqual(o.name, "YES"));
      const noOutcome = outcomes.find((o) => namesEqual(o.name, "NO"));
      const directional = parseDirectionalYesNoTeams(question);

      if (yesOutcome && noOutcome && directional && canonical.yesTeam) {
        const yesMapsToCanonicalYes = namesEqual(directional.yesTeam, canonical.yesTeam);
        oddsYes = yesMapsToCanonicalYes ? yesOutcome.decimalOdds : noOutcome.decimalOdds;
        oddsNo = yesMapsToCanonicalYes ? noOutcome.decimalOdds : yesOutcome.decimalOdds;
      } else if (yesOutcome && noOutcome) {
        oddsYes = yesOutcome.decimalOdds;
        oddsNo = noOutcome.decimalOdds;
      }
    }

    if (!(oddsYes && oddsNo)) {
      skippedNoOdds++;
      continue;
    }

    const externalId = String(
      market?.id || market?.conditionId || market?.clobTokenIds || market?.slug || ""
    ).trim();
    if (!externalId || seenExternalIds.has(externalId)) {
      skippedNoExternalId++;
      continue;
    }
    seenExternalIds.add(externalId);

    const externalEventId = String(
      market?.eventId || market?.events?.[0]?.id || market?.slug || externalId
    ).trim();

    normalized.push({
      source: "polymarket",
      bookName: "Polymarket",
      externalEventId,
      externalId,
      eventName: canonical.eventName,
      startTime:
        market?.endDate ||
        market?.end_date_iso ||
        market?.startDate ||
        market?.start_date_iso ||
        null,
      marketName: canonical.marketName,
      marketType: "two_way",
      outcomes: [
        { name: "YES", decimalOdds: oddsYes },
        { name: "NO", decimalOdds: oddsNo }
      ]
    });
  }

  skippedNoCanonical =
    pages.length - normalized.length - skippedNoOutcomes - skippedNoOdds - skippedNoExternalId;
  console.log(
    `[Polymarket] fetched=${pages.length} normalized=${normalized.length} ` +
      `skipped_no_canonical=${Math.max(0, skippedNoCanonical)} ` +
      `skipped_no_outcomes=${skippedNoOutcomes} skipped_no_odds=${skippedNoOdds} ` +
      `skipped_no_external_id=${skippedNoExternalId}`
  );

  return normalized;
}
