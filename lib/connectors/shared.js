function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function compareText(a, b) {
  return normalizeText(a).localeCompare(normalizeText(b), undefined, {
    sensitivity: "base"
  });
}

export function buildCanonicalMatchupName(team1, team2) {
  const t1 = normalizeText(team1);
  const t2 = normalizeText(team2);
  if (!t1 || !t2) return null;
  return compareText(t1, t2) <= 0 ? [t1, t2] : [t2, t1];
}

export function marketFromTeams(team1, team2) {
  const ordered = buildCanonicalMatchupName(team1, team2);
  if (!ordered) return null;
  return {
    eventName: `${ordered[0]} vs ${ordered[1]}`,
    marketName: "Match Winner",
    yesTeam: ordered[0],
    noTeam: ordered[1]
  };
}

export function kalshiPriceToDecimalOdds(rawPrice) {
  if (rawPrice == null) return null;
  const n = Number(rawPrice);
  if (!Number.isFinite(n)) return null;

  // Kalshi now returns *_dollars fields (0-1 range). Keep backward compatibility with cent fields.
  const dollars = n > 1 ? n / 100 : n;
  if (!(dollars > 0 && dollars < 1)) return null;

  return Number((1 / dollars).toFixed(6));
}
