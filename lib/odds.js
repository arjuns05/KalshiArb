export function americanToDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) throw new Error("Invalid american odds");
  if (a > 0) return 1 + a / 100;
  return 1 + 100 / Math.abs(a);
}

export function decimalToImpliedProb(decimalOdds) {
  const d = Number(decimalOdds);
  if (!Number.isFinite(d) || d <= 1) throw new Error("Invalid decimal odds");
  return 1 / d;
}
