import { fetchKalshiMarkets } from "../lib/connectors/kalshi.js";
import { fetchPolymarketMarkets } from "../lib/connectors/polymarket.js";
import { fetchOddsApiMarkets } from "../lib/connectors/oddsapi.js";

async function main() {
  const kalshi = await fetchKalshiMarkets();
  const pm = await fetchPolymarketMarkets();
  const odds = await fetchOddsApiMarkets();

  console.log("Kalshi:", kalshi);
  console.log("Polymarket:", pm);
  console.log("OddsAPI:", odds);

  console.log("\nNext step: upsert these into Market/Outcome/Quote tables.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
