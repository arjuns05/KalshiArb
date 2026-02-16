import { decimalToImpliedProb } from "./odds";

/**
 * Apply a conservative "slippage" adjustment to decimal odds.
 * If slippageBps = 50, we reduce odds by 0.50% to be safer.
 */
export function applySlippageToDecimalOdds(decimalOdds, slippageBps) {
  const d = Number(decimalOdds);
  const bps = Number(slippageBps || 0);
  if (!Number.isFinite(d) || d <= 1) return d;

  const factor = 1 - bps / 10000;
  // reduce odds => worse price => more conservative
  return Math.max(1.0001, d * factor);
}

/**
 * Very rough fee model placeholder.
 * - For sportsbook odds, fee is "already in the vig" so we do nothing.
 * - For Kalshi/Polymarket style contracts, you might model explicit fees.
 *
 * MVP: a simple penalty to implied probability (or odds) is acceptable.
 */
export function applyFeeModel({ bookType, decimalOdds, includeFees }) {
  if (!includeFees) return decimalOdds;

  // MVP heuristic:
  // - kalshi: slightly worsen odds by 0.3%
  // - polymarket: slightly worsen odds by 0.5%
  // - sportsbook: no change
  let penalty = 0;
  if (bookType === "kalshi") penalty = 0.003;
  if (bookType === "polymarket") penalty = 0.005;

  if (penalty === 0) return decimalOdds;

  // Convert to implied prob, increase prob slightly (worse), then convert back to odds.
  const p = decimalToImpliedProb(decimalOdds);
  const p2 = Math.min(0.999999, p * (1 + penalty));
  return 1 / p2;
}
