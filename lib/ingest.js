import { prisma } from "./db";
import { makeCanonicalKey, makeEventKey } from "./ingestKey";
import { eventSimilarityScore, sharedTokenCount } from "./textSimilarity";

async function upsertBook({ name, type }, ctx = {}) {
  if (!name || typeof name !== "string" || !name.trim()) {
    console.error("Skipping market with missing book name", { name, type, ...ctx });
    return null; // caller must handle
  }

  const cleanName = name.trim();

  return prisma.book.upsert({
    where: { name: cleanName },
    update: { type },
    create: { name: cleanName, type }
  });
}


async function upsertEvent({ eventName, startTime, eventKey }) {
  return prisma.event.upsert({
    where: { eventKey },
    update: { name: eventName, startTime: startTime ? new Date(startTime) : null },
    create: { name: eventName, startTime: startTime ? new Date(startTime) : null, eventKey }
  });
}

async function upsertMarket({ bookId, eventId, externalId, name, marketType }) {
  return prisma.market.upsert({
    where: { bookId_externalId: { bookId, externalId } },
    update: { name, marketType, eventId },
    create: { bookId, eventId, externalId, name, marketType }
  });
}

async function upsertOutcome({ marketId, name }) {
  // safest is findFirst/create, because we didn't add @@unique([marketId,name]) yet.
  const existing = await prisma.outcome.findFirst({ where: { marketId, name } });
  if (existing) return existing;
  return prisma.outcome.create({ data: { marketId, name } });
}

async function createQuote({ outcomeId, decimalOdds, source }) {
  return prisma.quote.create({
    data: { outcomeId, decimalOdds: Number(decimalOdds), source }
  });
}

async function upsertCanonicalMarket({ eventId, eventName, marketName, marketType }) {
  const canonicalKey = makeCanonicalKey({ eventName, marketName, marketType });
  return prisma.canonicalMarket.upsert({
    where: { canonicalKey },
    update: { name: marketName, marketType, eventId },
    create: {
      canonicalKey,
      name: marketName,
      marketType,
      eventId,
      outcomes: { create: [{ name: "YES" }, { name: "NO" }] } // MVP: two-way only
    },
    include: { outcomes: true }
  });
}

async function linkMarketToCanonical({
  canonicalMarketId,
  marketId,
  confidence = 0.6,
  method = "auto"
}) {
  // upsert on @@unique([canonicalMarketId, marketId])
  return prisma.marketMapping.upsert({
    where: { canonicalMarketId_marketId: { canonicalMarketId, marketId } },
    update: { confidence, method },
    create: { canonicalMarketId, marketId, confidence, method }
  });
}

async function linkOutcomes({ canonicalOutcomes, marketOutcomes }) {
  // assumes outcome names match YES/NO for MVP
  for (const co of canonicalOutcomes) {
    const match = marketOutcomes.find((o) => o.name.toUpperCase() === co.name.toUpperCase());
    if (!match) continue;

    await prisma.outcomeLink.upsert({
      where: { canonicalOutcomeId_outcomeId: { canonicalOutcomeId: co.id, outcomeId: match.id } },
      update: {},
      create: { canonicalOutcomeId: co.id, outcomeId: match.id }
    });
  }
}

export async function ingestNormalizedMarkets(normalizedMarkets) {
  let createdQuotes = 0;
  let touchedMarkets = 0;
  let touchedCanonicals = 0;
  let fuzzyMatches = 0;

  const SIMILARITY_THRESHOLD = Number(
    process.env.EVENT_SIMILARITY_THRESHOLD || process.env.EVENT_MATCH_THRESHOLD || "0.85"
  );
  const threshold = Number.isFinite(SIMILARITY_THRESHOLD) ? SIMILARITY_THRESHOLD : 0.85;
  const MIN_SHARED_TOKENS = Number(process.env.EVENT_MIN_SHARED_TOKENS || "2");
  const SECOND_BEST_GAP = Number(process.env.EVENT_SECOND_BEST_GAP || "0.05");
  const MAX_START_TIME_DIFF_DAYS = Number(process.env.EVENT_MAX_START_TIME_DIFF_DAYS || "7");

  const canonicalCache = await prisma.canonicalMarket.findMany({
    where: { marketType: "two_way" },
    include: {
      event: true,
      outcomes: true,
      mappings: {
        include: {
          market: { include: { book: true } }
        }
      }
    }
  });

  function getCounterpartySource(source) {
    if (source === "kalshi") return "polymarket";
    if (source === "polymarket") return "kalshi";
    return null;
  }

  function getCanonicalSourceTypes(cm) {
    return new Set(
      cm.mappings.map((m) => m?.market?.book?.type).filter(Boolean)
    );
  }

  function findSimilarCanonical({ source, eventName, marketType, sourceTime }) {
    const counterparty = getCounterpartySource(source);
    if (!counterparty || !eventName) return null;

    const candidates = [];
    for (const cm of canonicalCache) {
      if (cm.marketType !== marketType) continue;

      const sourceTypes = getCanonicalSourceTypes(cm);
      if (!sourceTypes.has(counterparty)) continue;

      const targetEventName = cm.event?.name || "";
      const shared = sharedTokenCount(eventName, targetEventName);
      if (shared < MIN_SHARED_TOKENS) continue;

      const targetTime = cm.event?.startTime ? new Date(cm.event.startTime) : null;
      if (sourceTime && targetTime && Number.isFinite(MAX_START_TIME_DIFF_DAYS)) {
        const diffMs = Math.abs(sourceTime.getTime() - targetTime.getTime());
        const maxDiffMs = MAX_START_TIME_DIFF_DAYS * 24 * 60 * 60 * 1000;
        if (diffMs > maxDiffMs) continue;
      }

      const score = eventSimilarityScore(eventName, targetEventName);
      candidates.push({ cm, score, shared });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (best.score < threshold) return null;

    const second = candidates[1];
    if (second && best.score - second.score < SECOND_BEST_GAP) return null;

    return best;
  }

  for (const m of normalizedMarkets) {
    if (m.marketType !== "two_way") continue;
    if (!m.outcomes || m.outcomes.length !== 2) continue;

    const bookType =
      m.source === "kalshi" ? "kalshi" : m.source === "polymarket" ? "polymarket" : "sportsbook";

    const book = await upsertBook(
        { name: m.bookName, type: bookType },
        { source: m.source, externalId: m.externalId, eventName: m.eventName }
        );

        if (!book) continue;


    const eventKey = makeEventKey({
      source: m.source,
      externalEventId: m.externalEventId,
      eventName: m.eventName,
      startTime: m.startTime
    });

    const event = await upsertEvent({ eventName: m.eventName, startTime: m.startTime, eventKey });

    const market = await upsertMarket({
      bookId: book.id,
      eventId: event.id,
      externalId: m.externalId,
      name: m.marketName,
      marketType: m.marketType
    });

    // outcomes + quotes
    const marketOutcomes = [];
    for (const o of m.outcomes) {
      const out = await upsertOutcome({ marketId: market.id, name: o.name });
      marketOutcomes.push(out);
      await createQuote({ outcomeId: out.id, decimalOdds: o.decimalOdds, source: m.source });
      createdQuotes++;
    }

    touchedMarkets++;

    // canonical linking (fuzzy match first, then exact canonical key fallback)
    const mStartTime = m.startTime ? new Date(m.startTime) : null;
    const fuzzy = findSimilarCanonical({
      source: m.source,
      eventName: m.eventName,
      marketType: m.marketType,
      sourceTime: mStartTime
    });

    const cm =
      fuzzy?.cm ||
      (await upsertCanonicalMarket({
        eventId: event.id,
        eventName: m.eventName,
        marketName: m.marketName,
        marketType: m.marketType
      }));

    if (fuzzy) {
      fuzzyMatches++;
    }

    await linkMarketToCanonical({
      canonicalMarketId: cm.id,
      marketId: market.id,
      confidence: fuzzy ? fuzzy.score : 1,
      method: fuzzy ? "event_text_similarity" : "canonical_key"
    });
    await linkOutcomes({ canonicalOutcomes: cm.outcomes, marketOutcomes });
    touchedCanonicals++;

    // keep cache current as we create/link canonicals during this ingest batch
    const existingIdx = canonicalCache.findIndex((x) => x.id === cm.id);
    if (existingIdx === -1) {
      canonicalCache.push({
        ...cm,
        event,
        mappings: [{ market: { book: { type: bookType } } }]
      });
    } else {
      canonicalCache[existingIdx].mappings.push({
        market: { book: { type: bookType } }
      });
    }
  }

  console.log(
    `[Ingest] similarity_threshold=${threshold} fuzzy_matches=${fuzzyMatches} ` +
      `touched_markets=${touchedMarkets} touched_canonicals=${touchedCanonicals}`
  );

  return { touchedMarkets, touchedCanonicals, createdQuotes, fuzzyMatches };
}
