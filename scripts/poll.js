import { fetchKalshiMarkets } from "../lib/connectors/kalshi.js";
import { fetchPolymarketMarkets } from "../lib/connectors/polymarket.js";

async function main() {
  const kalshi = await fetchKalshiMarkets();
  const pm = await fetchPolymarketMarkets();

  console.log("Kalshi markets normalized:", kalshi.length);
  console.log("Polymarket markets normalized:", pm.length);
  console.log("Sample Kalshi market:", kalshi[0] || null);
  console.log("Sample Polymarket market:", pm[0] || null);

  console.log("\nNext step: upsert these into Market/Outcome/Quote tables.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
