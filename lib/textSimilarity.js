function toBigrams(value) {
  const s = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!s) return [];
  if (s.length === 1) return [s];

  const grams = [];
  for (let i = 0; i < s.length - 1; i++) {
    grams.push(s.slice(i, i + 2));
  }
  return grams;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with"
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenize(value) {
  return normalize(value)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

export function tokenJaccardScore(a, b) {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (aSet.size === 0 || bSet.size === 0) return 0;

  let intersection = 0;
  for (const t of aSet) {
    if (bSet.has(t)) intersection++;
  }
  const union = aSet.size + bSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function sharedTokenCount(a, b) {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  let intersection = 0;
  for (const t of aSet) {
    if (bSet.has(t)) intersection++;
  }
  return intersection;
}

/**
 * Composite confidence score in [0,1].
 * Mixes char-level and token-level similarity for more robust matching.
 */
export function eventSimilarityScore(a, b) {
  const dice = similarityScore(a, b);
  const jaccard = tokenJaccardScore(a, b);
  return 0.45 * dice + 0.55 * jaccard;
}

/**
 * Returns a confidence score in [0,1] using Sørensen-Dice coefficient over character bigrams.
 */
export function similarityScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = toBigrams(a);
  const bBigrams = toBigrams(b);
  if (aBigrams.length === 0 || bBigrams.length === 0) return 0;

  const counts = new Map();
  for (const g of aBigrams) counts.set(g, (counts.get(g) || 0) + 1);

  let overlap = 0;
  for (const g of bBigrams) {
    const c = counts.get(g) || 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }

  return (2 * overlap) / (aBigrams.length + bBigrams.length);
}
