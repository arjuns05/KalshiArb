import { prisma } from "../../../../lib/db";

export async function GET() {
  const markets = await prisma.canonicalMarket.findMany({
    orderBy: { createdAt: "desc" },
    include: { event: true }
  });

  return Response.json({
    markets: markets.map((m) => ({
      id: m.id,
      name: m.name,
      marketType: m.marketType,
      eventName: m.event?.name || "Unknown Event"
    }))
  });
}
