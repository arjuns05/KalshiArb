import { ingestNormalizedMarkets } from "../../../../lib/ingest";
import { fetchKalshiMarkets } from "../../../../lib/connectors/kalshi";
import { fetchPolymarketMarkets } from "../../../../lib/connectors/polymarket";

export async function POST() {
  try {
    const [kalshi, poly] = await Promise.all([
      fetchKalshiMarkets(),
      fetchPolymarketMarkets()
    ]);

    const all = [...(kalshi || []), ...(poly || [])];

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
