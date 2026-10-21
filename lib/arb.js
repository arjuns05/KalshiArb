import { getMarkets } from "./markets.js";
import { similarity } from "./text.js";

function validQuotes(market) {
  return [market.yesAsk, market.noAsk].every((price) => Number.isFinite(price) && price > 0 && price <= 1);
}

function opportunityLeg(market, side, price) {
  return {
    id: market.id,
    title: market.title,
    closeTime: market.closeTime || null,
    updatedAt: market.updatedAt || null,
    fetchedAt: market.fetchedAt || null,
    quoteType: market.quoteType || null,
    quoteTimestamp: market.quoteTimestamps?.[side.toLowerCase()] ?? null,
    venue: market.venue,
    side,
    price,
    color: market.venue === "Kalshi" ? "blue" : "purple",
  };
}

function buildOpportunity(yesMarket, noMarket, score) {
  const cost = yesMarket.yesAsk + noMarket.noAsk;
  return {
    title: yesMarket.title,
    closeTime: yesMarket.closeTime || noMarket.closeTime,
    score,
    settlementVerified: false,
    edge: 1 - cost,
    cost,
    markets: [opportunityLeg(yesMarket, "Yes", yesMarket.yesAsk), opportunityLeg(noMarket, "No", noMarket.noAsk)],
  };
}

export function computeArbitrage(kalshi, polymarket, failures = {}) {
  const matches = [];
  kalshi = kalshi.filter(validQuotes);
  polymarket = polymarket.filter(validQuotes);

  kalshi.forEach((kalshiMarket) => {
    polymarket.forEach((polymarketMarket) => {
      const score = similarity(kalshiMarket.title, polymarketMarket.title);
      if (score < 0.36) return;

      matches.push(buildOpportunity(kalshiMarket, polymarketMarket, score));
      matches.push(buildOpportunity(polymarketMarket, kalshiMarket, score));
    });
  });

  matches.sort((left, right) => right.edge - left.edge);

  return {
    scannedAt: new Date().toISOString(),
    best: matches[0] || null,
    opportunities: matches,
    failures,
    stats: {
      kalshi: kalshi.length,
      polymarket: polymarket.length,
      matches: Math.floor(matches.length / 2),
      opportunities: matches.filter((match) => match.edge > 0).length,
    },
  };
}

export async function loadArbitrage() {
  const { kalshi, polymarket, failures } = await getMarkets();
  return computeArbitrage(kalshi, polymarket, failures);
}
