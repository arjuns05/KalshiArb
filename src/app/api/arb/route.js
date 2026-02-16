import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { applyFeeModel, applySlippageToDecimalOdds } from "../../../../lib/normalize";
import { computeTwoWayArb } from "../../../../lib/arb";

const BodySchema = z.object({
  canonicalMarketId: z.string().min(1),
  budget: z.number().positive(),
  includeFees: z.boolean().default(true),
  slippageBps: z.number().min(0).max(500).default(0)
});

export async function POST(req) {
  try {
    const body = BodySchema.parse(await req.json());

    const cm = await prisma.canonicalMarket.findUnique({
      where: { id: body.canonicalMarketId },
      include: {
        event: true,
        outcomes: {
          include: {
            outcomeLinks: {
              include: {
                outcome: {
                  include: {
                    market: { include: { book: true } },
                    quotes: { orderBy: { timestamp: "desc" }, take: 5 }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!cm) return Response.json({ error: "Canonical market not found" }, { status: 404 });
    if (cm.marketType !== "two_way") {
      return Response.json({ error: "MVP supports only two_way markets" }, { status: 400 });
    }
    if (cm.outcomes.length !== 2) {
      return Response.json({ error: "Canonical market must have exactly 2 outcomes" }, { status: 400 });
    }

    const ALLOWED_BOOK_TYPES = new Set(["kalshi", "polymarket"]);

    // For each canonical outcome, find the best available quote (max decimal odds) among linked outcomes.
    const legs = cm.outcomes.map((co) => {
      let best = null;

      for (const link of co.outcomeLinks) {
        const out = link.outcome;
        const book = out.market.book;
        if (!ALLOWED_BOOK_TYPES.has(book?.type)) continue;
        const latestQuote = out.quotes?.[0]; // already ordered desc

        if (!latestQuote) continue;

        let d = Number(latestQuote.decimalOdds);

        // fee model (placeholder)
        d = applyFeeModel({ bookType: book.type, decimalOdds: d, includeFees: body.includeFees });

        // slippage (conservative)
        d = applySlippageToDecimalOdds(d, body.slippageBps);

        const candidate = {
          outcomeName: co.name,
          bestBookName: book.name,
          bookType: book.type,
          decimalOdds: d,
          rawDecimalOdds: latestQuote.decimalOdds,
          quoteSource: latestQuote.source,
          quoteTimestamp: latestQuote.timestamp
        };

        if (!best || candidate.decimalOdds > best.decimalOdds) best = candidate;
      }

      return best;
    });

    if (legs.some((x) => !x)) {
      return Response.json(
        { error: "Missing Kalshi/Polymarket quotes for one or more outcomes. Ingest first." },
        { status: 400 }
      );
    }

    const result = computeTwoWayArb({ budget: body.budget, legs });

    return Response.json({
      canonicalMarket: {
        id: cm.id,
        name: cm.name,
        eventName: cm.event?.name || "Unknown Event"
      },
      ...result
    });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Unknown error" },
      { status: 400 }
    );
  }
}
