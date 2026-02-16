export function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function makeEventKey({ source, externalEventId, eventName, startTime }) {
  // If you have stable external IDs later, prefer those.
  // MVP: name + date bucket.
  const date = startTime ? new Date(startTime).toISOString().slice(0, 10) : "na";
  return `${source}:${normText(eventName)}:${date}`;
}

export function makeCanonicalKey({ eventName, marketName, marketType }) {
  return `${normText(eventName)}|${normText(marketName)}|${marketType}`;
}
