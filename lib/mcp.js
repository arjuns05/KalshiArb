import { loadArbitrage } from "./arb";
import { enrichScan } from "./enrichment";

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export const MARKET_CONTEXT_TOOL = {
  name: "market_context",
  description:
    "Fetch the latest Kalshi/Polymarket arbitrage scan and answer a question using that scan as context.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "Question to answer about the latest arbitrage scan.",
      },
      includeRawScan: {
        type: "boolean",
        description: "Whether to include the raw scan object in the tool response.",
      },
    },
    required: ["question"],
  },
};

export function listToolsResult() {
  return {
    tools: [MARKET_CONTEXT_TOOL],
  };
}

export async function callTool(name, args = {}) {
  if (name !== MARKET_CONTEXT_TOOL.name) {
    throw new Error(`unknown tool: ${name}`);
  }

  const scan = await loadArbitrage();
  const context = await enrichScan(scan, args.question);
  const payload = {
    question: args.question || "What should I know about the latest scan?",
    answer: context.answer,
    source: context.source,
    scanSummary: {
      bestTitle: scan.best?.title || null,
      bestEdge: scan.best?.edge || null,
      kalshiMarkets: scan.stats.kalshi,
      polymarketMarkets: scan.stats.polymarket,
      matches: scan.stats.matches,
      opportunities: scan.stats.opportunities,
      failures: scan.failures,
    },
  };

  if (args.includeRawScan) {
    payload.scan = scan;
  }

  return {
    content: [
      {
        type: "text",
        text: context.answer,
      },
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

export function initializeResult() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: "kalshi-polymarket-arb",
      version: "1.0.0",
    },
    capabilities: {
      tools: {},
    },
  };
}
