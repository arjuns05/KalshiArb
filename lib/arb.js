import { getMarkets } from "./markets";
import { similarity } from "./text";

function buildOpportunity(yesMarket, yesSide, yesPrice, noMarket, noSide, noPrice, score) {
  const cost = yesPrice + noPrice;

  return {
    title: yesMarket.title,
    closeTime: yesMarket.closeTime || noMarket.closeTime,
    score,
    edge: 1 - cost,
    cost,
    markets: [
      {
        venue: yesMarket.venue,
        side: yesSide,
        price: yesPrice,
        color: yesMarket.venue === "Kalshi" ? "blue" : "purple",
      },
      {
        venue: noMarket.venue,
        side: noSide,
        price: noPrice,
        color: noMarket.venue === "Kalshi" ? "blue" : "purple",
      },
    ],
  };
}

export async function loadArbitrage() {
  const { kalshi, polymarket, failures } = await getMarkets();
  const matches = [];

  kalshi.forEach((kalshiMarket) => {
    polymarket.forEach((polymarketMarket) => {
      const score = similarity(kalshiMarket.title, polymarketMarket.title);
      if (score < 0.36) return;

      matches.push(
        buildOpportunity(
          kalshiMarket,
          "Yes",
          kalshiMarket.yesAsk,
          polymarketMarket,
          "No",
          polymarketMarket.noAsk,
          score,
        ),
      );

      matches.push(
        buildOpportunity(
          polymarketMarket,
          "Yes",
          polymarketMarket.yesAsk,
          kalshiMarket,
          "No",
          kalshiMarket.noAsk,
          score,
        ),
      );
    });
  });

  matches.sort((left, right) => right.edge - left.edge);

  return {
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
