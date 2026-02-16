import { marketFromTeams } from "./shared.js";

const ODDS_API_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const ODDS_API_SPORTS = (process.env.ODDS_API_SPORTS || "upcoming")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ODDS_API_MARKETS = process.env.ODDS_API_MARKETS || "h2h";
const ODDS_API_REGIONS = process.env.ODDS_API_REGIONS || "us";
const ODDS_API_ODDS_FORMAT = process.env.ODDS_API_ODDS_FORMAT || "decimal";
const ODDS_API_BOOKMAKERS = (process.env.ODDS_API_BOOKMAKERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function toDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 1) return null;
  return n;
}

function getPriceByTeam(outcomes, teamName) {
  if (!Array.isArray(outcomes)) return null;
  const match = outcomes.find((o) => String(o?.name || "").toLowerCase() === teamName.toLowerCase());
  return toDecimal(match?.price);
}

async function fetchSportOdds(sportKey, apiKey) {
  const params = new URLSearchParams({
    apiKey,
    regions: ODDS_API_REGIONS,
    markets: ODDS_API_MARKETS,
    oddsFormat: ODDS_API_ODDS_FORMAT,
    dateFormat: "iso"
  });

  if (ODDS_API_BOOKMAKERS.length > 0) {
    params.set("bookmakers", ODDS_API_BOOKMAKERS.join(","));
  }

  const url = `${ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/odds?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`OddsAPI ${sportKey} request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchOddsApiMarkets() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn("[OddsAPI] ODDS_API_KEY not set; skipping fetch");
    return [];
  }

  const settled = await Promise.allSettled(
    ODDS_API_SPORTS.map((sportKey) => fetchSportOdds(sportKey, apiKey))
  );

  const events = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && Array.isArray(s.value)) {
      events.push(...s.value);
    } else if (s.status === "rejected") {
      console.error("[OddsAPI] Fetch failed:", s.reason);
    }
  }

  const normalized = [];

  for (const event of events) {
    const homeTeam = String(event?.home_team || "").trim();
    const awayTeam = String(event?.away_team || "").trim();
    if (!homeTeam || !awayTeam) continue;

    const canonical = marketFromTeams(homeTeam, awayTeam);
    if (!canonical) continue;

    for (const bookmaker of event?.bookmakers || []) {
      const h2h = (bookmaker?.markets || []).find((m) => m?.key === "h2h");
      if (!h2h || !Array.isArray(h2h.outcomes)) continue;

      const pYes = getPriceByTeam(h2h.outcomes, canonical.yesTeam);
      const pNo = getPriceByTeam(h2h.outcomes, canonical.noTeam);
      if (!(pYes && pNo)) continue;

      const bookKey = String(bookmaker?.key || bookmaker?.title || "book").trim();
      normalized.push({
        source: "oddsapi",
        bookName: String(bookmaker?.title || bookKey),
        externalEventId: String(event?.id || ""),
        externalId: `${bookKey}:${event.id}:h2h`,
        eventName: canonical.eventName,
        startTime: event?.commence_time || null,
        marketName: canonical.marketName,
        marketType: "two_way",
        outcomes: [
          { name: "YES", decimalOdds: pYes },
          { name: "NO", decimalOdds: pNo }
        ]
      });
    }
  }

  return normalized;
}
