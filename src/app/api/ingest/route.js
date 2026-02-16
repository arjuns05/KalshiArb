import { ingestNormalizedMarkets } from "../../../../lib/ingest";
import { fetchKalshiMarkets } from "../../../../lib/connectors/kalshi";
import { fetchOddsApiMarkets } from "../../../../lib/connectors/oddsapi";
import { fetchPolymarketMarkets } from "../../../../lib/connectors/polymarket";
import { startPolling } from "../../../../lib/polling-service";

// Initialize polling service on first import (Next.js server context)
if (typeof window === "undefined") {
  startPolling();
}

export async function POST() {
  try {
    const [kalshi, odds, poly] = await Promise.all([
      fetchKalshiMarkets(),
      fetchOddsApiMarkets(),
      fetchPolymarketMarkets()
    ]);

    const all = [...(kalshi || []), ...(odds || []), ...(poly || [])];

    const summary = await ingestNormalizedMarkets(all);

    return Response.json({
      ok: true,
      fetched: all.length,
      ...summary
    });
  } catch (err) {
    console.error("INGEST ERROR:", err);
    return Response.json(
      {
        ok: false,
        error: err?.message || "Unknown ingest error"
      },
      { status: 500 }
    );
  }
}
