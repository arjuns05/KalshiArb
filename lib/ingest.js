import { prisma } from "./db";
import { makeCanonicalKey, makeEventKey } from "./ingestKey";

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

async function linkMarketToCanonical({ canonicalMarketId, marketId }) {
  // upsert on @@unique([canonicalMarketId, marketId])
  return prisma.marketMapping.upsert({
    where: { canonicalMarketId_marketId: { canonicalMarketId, marketId } },
    update: {},
    create: { canonicalMarketId, marketId, confidence: 0.6, method: "auto" }
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

    // canonical linking (auto match)
    const cm = await upsertCanonicalMarket({
      eventId: event.id,
      eventName: m.eventName,
      marketName: m.marketName,
      marketType: m.marketType
    });

    await linkMarketToCanonical({ canonicalMarketId: cm.id, marketId: market.id });
    await linkOutcomes({ canonicalOutcomes: cm.outcomes, marketOutcomes });
    touchedCanonicals++;
  }

  return { touchedMarkets, touchedCanonicals, createdQuotes };
}
