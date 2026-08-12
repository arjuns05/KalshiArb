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

function simpleContext(opportunity) {
  const first = opportunity.markets[0];
  const second = opportunity.markets[1];
  const edge = (opportunity.edge * 100).toFixed(1);

  return `Buy ${first.side} on ${first.venue} and ${second.side} on ${second.venue}. The combined cost is $${opportunity.cost.toFixed(
    3,
  )}, so the current edge is ${edge}% before fees and execution risk.`;
}
