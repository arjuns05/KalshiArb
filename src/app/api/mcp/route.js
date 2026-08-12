import { NextResponse } from "next/server";
import { loadArbitrage } from "../../../../lib/arb";
import { enrichOpportunity } from "../../../../lib/enrichment";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const result = await loadArbitrage();
  const context = await enrichOpportunity(result.best, body.question);

  return NextResponse.json({
    tool: "market_context",
    question: body.question || "What is the best arbitrage opportunity?",
    opportunity: result.best,
    context,
  });
}
