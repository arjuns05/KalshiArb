import { prisma } from "../../../../../lib/db";


function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function makeCanonicalKey(eventName, marketName, marketType) {
  return `${normText(eventName)}|${normText(marketName)}|${marketType}`;
}


export async function GET() {
  // Books
  const kalshi = await prisma.book.upsert({
    where: { name: "Kalshi" },
    update: {},
    create: { name: "Kalshi", type: "kalshi" }
  });

  const dk = await prisma.book.upsert({
    where: { name: "DraftKings" },
    update: {},
    create: { name: "DraftKings", type: "sportsbook" }
  });

  const pm = await prisma.book.upsert({
    where: { name: "Polymarket" },
    update: {},
    create: { name: "Polymarket", type: "polymarket" }
  });

  // Event
function makeEventKey(eventName, startTime) {
  const date = startTime ? new Date(startTime).toISOString().slice(0, 10) : "na";
  return `seed:${normText(eventName)}:${date}`;
}
const startTime = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const eventName = "Super Bowl Winner (Demo)";
const eventKey = makeEventKey(eventName, startTime);

const event = await prisma.event.upsert({
  where: { eventKey },
  update: { name: eventName, startTime },
  create: { name: eventName, startTime, eventKey }
});
  // Canonical Market + Outcomes (two-way)
 const canonicalKey = makeCanonicalKey(event.name, "Team A wins (Demo Yes/No)", "two_way");

const cm = await prisma.canonicalMarket.upsert({
  where: { canonicalKey },
  update: {},
  create: {
    eventId: event.id,
    name: "Team A wins (Demo Yes/No)",
    marketType: "two_way",
    canonicalKey,
    outcomes: {
      create: [{ name: "YES" }, { name: "NO" }]
    }
  },
  include: { outcomes: true }
});



async function upsertMarketWithOutcomes({
  prisma,
  bookId,
  eventId,
  externalId,
  name,
  marketType = "two_way",
  outcomeNames = ["YES", "NO"]
}) {
  // 1) Upsert market on (bookId, externalId)
  const market = await prisma.market.upsert({
    where: {
      bookId_externalId: { bookId, externalId }
    },
    update: {
      eventId,
      name,
      marketType
    },
    create: {
      bookId,
      eventId,
      externalId,
      name,
      marketType
    }
  });

  // 2) Ensure outcomes exist (idempotent)
  for (const outcomeName of outcomeNames) {
    const existing = await prisma.outcome.findFirst({
      where: { marketId: market.id, name: outcomeName }
    });
    if (!existing) {
      await prisma.outcome.create({
        data: { marketId: market.id, name: outcomeName }
      });
    }
  }

  // 3) Return market with outcomes
  const marketWithOutcomes = await prisma.market.findUnique({
    where: { id: market.id },
    include: { outcomes: true }
  });

  return marketWithOutcomes;
}


  // External markets
const marketSpecs = [
  { label: "kalshi", bookId: kalshi.id, externalId: "kalshi_demo_1", name: "Kalshi: Team A wins?" },
  { label: "dk",     bookId: dk.id,     externalId: "dk_demo_1",     name: "DraftKings: Team A wins?" },
  { label: "pm",     bookId: pm.id,     externalId: "pm_demo_1",     name: "Polymarket: Team A wins?" }
];

const marketsByLabel = {};
for (const spec of marketSpecs) {
  marketsByLabel[spec.label] = await upsertMarketWithOutcomes({
    prisma,
    bookId: spec.bookId,
    eventId: event.id,
    externalId: spec.externalId,
    name: spec.name,
    marketType: "two_way",
    outcomeNames: ["YES", "NO"]
  });
}

const kalshiMarket = marketsByLabel.kalshi;
const dkMarket = marketsByLabel.dk;
const pmMarket = marketsByLabel.pm;

  // Mapping canonical market to external markets
 const mappings = [
  { canonicalMarketId: cm.id, marketId: kalshiMarket.id, confidence: 1, method: "manual" },
  { canonicalMarketId: cm.id, marketId: dkMarket.id, confidence: 1, method: "manual" },
  { canonicalMarketId: cm.id, marketId: pmMarket.id, confidence: 1, method: "manual" }
];

for (const m of mappings) {
  await prisma.marketMapping.upsert({
    where: {
      canonicalMarketId_marketId: {
        canonicalMarketId: m.canonicalMarketId,
        marketId: m.marketId
      }
    },
    update: {
      confidence: m.confidence,
      method: m.method
    },
    create: m
  });
}


  // Link canonical outcomes to each market's outcomes
  const [coYes, coNo] = cm.outcomes;

  const kalshiYes = kalshiMarket.outcomes.find((o) => o.name === "YES");
  const kalshiNo = kalshiMarket.outcomes.find((o) => o.name === "NO");
  const dkYes = dkMarket.outcomes.find((o) => o.name === "YES");
  const dkNo = dkMarket.outcomes.find((o) => o.name === "NO");
  const pmYes = pmMarket.outcomes.find((o) => o.name === "YES");
  const pmNo = pmMarket.outcomes.find((o) => o.name === "NO");

const links = [
  { canonicalOutcomeId: coYes.id, outcomeId: kalshiYes.id },
  { canonicalOutcomeId: coNo.id, outcomeId: kalshiNo.id },
  // ...
];

for (const l of links) {
  await prisma.outcomeLink.upsert({
    where: {
      canonicalOutcomeId_outcomeId: {
        canonicalOutcomeId: l.canonicalOutcomeId,
        outcomeId: l.outcomeId
      }
    },
    update: {},
    create: l
  });
}


  // Quotes (decimal odds) — set these so an arb can exist sometimes
  // Example: YES best on DK, NO best on Kalshi or PM.
  await prisma.quote.createMany({
    data: [
      { outcomeId: dkYes.id, decimalOdds: 2.10, source: "oddsapi" },
      { outcomeId: dkNo.id, decimalOdds: 1.75, source: "oddsapi" },

      { outcomeId: kalshiYes.id, decimalOdds: 1.95, source: "kalshi" },
      { outcomeId: kalshiNo.id, decimalOdds: 2.20, source: "kalshi" },

      { outcomeId: pmYes.id, decimalOdds: 2.00, source: "polymarket" },
      { outcomeId: pmNo.id, decimalOdds: 2.05, source: "polymarket" }
    ]
  });

  return Response.json({
    ok: true,
    seeded: {
      canonicalMarketId: cm.id,
      eventId: event.id
    }
  });
}
