import { prisma } from "../lib/db.js";

async function main() {
  // mimic the API seed logic: simplest is to call the endpoint,
  // but here we seed directly for local CLI usage.
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

  const event = await prisma.event.create({
    data: { name: "Seeded Event (CLI Demo)", startTime: new Date(Date.now() + 3e8) }
  });

  const cm = await prisma.canonicalMarket.create({
    data: {
      eventId: event.id,
      name: "Team A wins (CLI Yes/No)",
      marketType: "two_way",
      outcomes: { create: [{ name: "YES" }, { name: "NO" }] }
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


  await prisma.marketMapping.createMany({
    data: [
      { canonicalMarketId: cm.id, marketId: kalshiMarket.id, confidence: 1, method: "manual" },
      { canonicalMarketId: cm.id, marketId: dkMarket.id, confidence: 1, method: "manual" }
    ],
    skipDuplicates: true
  });

  const [coYes, coNo] = cm.outcomes;

  const kalshiYes = kalshiMarket.outcomes.find((o) => o.name === "YES");
  const kalshiNo = kalshiMarket.outcomes.find((o) => o.name === "NO");
  const dkYes = dkMarket.outcomes.find((o) => o.name === "YES");
  const dkNo = dkMarket.outcomes.find((o) => o.name === "NO");

  await prisma.outcomeLink.createMany({
    data: [
      { canonicalOutcomeId: coYes.id, outcomeId: kalshiYes.id },
      { canonicalOutcomeId: coNo.id, outcomeId: kalshiNo.id },
      { canonicalOutcomeId: coYes.id, outcomeId: dkYes.id },
      { canonicalOutcomeId: coNo.id, outcomeId: dkNo.id }
    ],
    skipDuplicates: true
  });

  await prisma.quote.createMany({
    data: [
      { outcomeId: dkYes.id, decimalOdds: 2.05, source: "oddsapi" },
      { outcomeId: dkNo.id, decimalOdds: 1.80, source: "oddsapi" },
      { outcomeId: kalshiYes.id, decimalOdds: 1.92, source: "kalshi" },
      { outcomeId: kalshiNo.id, decimalOdds: 2.25, source: "kalshi" }
    ]
  });

  console.log("Seed complete:", { canonicalMarketId: cm.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
