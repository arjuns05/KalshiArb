import { prisma } from "../../../../lib/db";

export async function GET() {
  const markets = await prisma.canonicalMarket.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      event: true,
      mappings: {
        include: {
          market: {
            include: { book: true }
          }
        }
      }
    }
  });

  const kalshiPolymarket = markets.filter((m) => {
    const bookTypes = new Set(
      m.mappings.map((mapping) => mapping?.market?.book?.type).filter(Boolean)
    );
    return bookTypes.has("kalshi") && bookTypes.has("polymarket");
  });

  return Response.json({
    markets: kalshiPolymarket.map((m) => ({
      id: m.id,
      name: m.name,
      marketType: m.marketType,
      eventName: m.event?.name || "Unknown Event"
    }))
  });
}
