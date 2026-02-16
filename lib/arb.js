import { decimalToImpliedProb } from "./odds";

/**
 * Given two best legs (one per outcome) with decimal odds,
 * determine if arbitrage exists and compute stake sizing.
 */
export function computeTwoWayArb({ budget, legs }) {
  if (!Array.isArray(legs) || legs.length !== 2) {
    throw new Error("MVP requires exactly 2 outcomes");
  }
  const T = Number(budget);
  if (!Number.isFinite(T) || T <= 0) throw new Error("Budget must be > 0");

  const d1 = legs[0].decimalOdds;
  const d2 = legs[1].decimalOdds;

  if (!(d1 > 1 && d2 > 1)) throw new Error("Decimal odds must be > 1");

  const p1 = decimalToImpliedProb(d1);
  const p2 = decimalToImpliedProb(d2);
  const sumImpliedProb = p1 + p2;

  // Arb exists if sum of implied probs < 1
  const isArb = sumImpliedProb < 1;

  // Equalize payout: stake proportional to implied probability
  const s1 = T * (p1 / (p1 + p2));
  const s2 = T * (p2 / (p1 + p2));

  // Guaranteed return factor: R = 1 / (p1+p2)
  const R = 1 / sumImpliedProb;
  const guaranteedProfit = T * (R - 1);
  const roi = guaranteedProfit / T;

  return {
    isArb,
    sumImpliedProb,
    guaranteedProfit,
    roi,
    legs: [
      { ...legs[0], stake: s1 },
      { ...legs[1], stake: s2 }
    ]
  };
}
