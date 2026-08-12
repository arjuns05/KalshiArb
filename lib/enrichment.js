export async function enrichOpportunity(opportunity, question) {
  if (!opportunity) {
    return {
      answer: "No cross-market opportunity is currently available.",
      source: "local",
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      answer: simpleContext(opportunity, question),
      source: "local",
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Explain this prediction-market arbitrage opportunity in plain English.
Question: ${question || "What should I know?"}
Market: ${opportunity.title}
Edge: ${(opportunity.edge * 100).toFixed(2)}%
Cost: $${opportunity.cost.toFixed(3)}
Venues: ${opportunity.markets
                  .map((market) => `${market.venue} ${market.side} at ${market.price}`)
                  .join(", ")}`,
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    return {
      answer: simpleContext(opportunity, question),
      source: "local",
    };
  }

  const data = await response.json();
  return {
    answer:
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      simpleContext(opportunity, question),
    source: "gemini",
  };
}

export async function enrichScan(scan, question) {
  const prompt = buildScanPrompt(scan, question);

  if (!process.env.GEMINI_API_KEY) {
    return {
      answer: localScanAnswer(scan, question),
      source: "local",
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    return {
      answer: localScanAnswer(scan, question),
      source: "local",
    };
  }

  const data = await response.json();
  return {
    answer:
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      localScanAnswer(scan, question),
    source: "gemini",
  };
}

function simpleContext(opportunity) {
  const first = opportunity.markets[0];
  const second = opportunity.markets[1];
  const edge = (opportunity.edge * 100).toFixed(1);

  return `Buy ${first.side} on ${first.venue} and ${second.side} on ${second.venue}. The combined cost is $${opportunity.cost.toFixed(
    3,
  )}, so the current edge is ${edge}% before fees and execution risk.`;
}

function buildScanPrompt(scan, question) {
  const best = scan.best;
  const stats = scan.stats;
  const bestText = best
    ? `Best opportunity:
Title: ${best.title}
Edge: ${(best.edge * 100).toFixed(2)}%
Cost: $${best.cost.toFixed(3)}
Close time: ${best.closeTime || "unknown"}
Title match score: ${(best.score * 100).toFixed(1)}%
Legs: ${best.markets
        .map((market) => `${market.venue} ${market.side} at ${market.price}`)
        .join(", ")}`
    : "No confident cross-market opportunity was found on this scan.";

  return `You are explaining a prediction-market arbitrage scan.
Answer the user's question using only this scan context. Keep the answer concise and mention fees/fill risk when relevant.

Question: ${question || "What should I know about the latest scan?"}

Scan stats:
Kalshi markets scanned: ${stats.kalshi}
Polymarket markets scanned: ${stats.polymarket}
Cross-market matches found: ${stats.matches}
Open opportunities with positive edge: ${stats.opportunities}
Kalshi error: ${scan.failures?.kalshi || "none"}
Polymarket error: ${scan.failures?.polymarket || "none"}

${bestText}`;
}

function localScanAnswer(scan) {
  const stats = scan.stats;

  if (!scan.best) {
    return `The latest scan checked ${stats.kalshi} Kalshi markets and ${stats.polymarket} Polymarket markets. It found ${stats.matches} likely cross-market matches, but no confident arbitrage opportunity with the current matching threshold.`;
  }

  return `${simpleContext(scan.best)} The scan checked ${stats.kalshi} Kalshi markets and ${stats.polymarket} Polymarket markets, found ${stats.matches} likely matches, and ${stats.opportunities} positive-edge opportunities.`;
}
