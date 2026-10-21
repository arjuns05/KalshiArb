import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export const POLYTRACKERS_URL = "https://polytrackers.com/api/mcp";
export const POLYTRACKERS_TOOLS = [
  "pt_mcp_capabilities_get", "pt_markets_search", "pt_market_intel_get",
  "pt_markets_batch_get", "pt_clob_price_get", "pt_agent_briefing_get",
  "pt_market_trades_get", "pt_anomalies_list", "pt_anomalies_get", "pt_anomaly_context_get",
];
const DEFAULT_TOOLS = {
  kalshi: ["search_events", "research_markets", "research_events", "get_event_markets", "get_market_history", "audit_settlement_rules", "search_series", "search_markets", "get_markets", "get_events", "get_market", "get_event", "get_orderbook"],
  polymarket: ["search_markets", "list_events", "list_markets", "get_market", "get_event", "get_orderbook", "get_prices", "get_spreads"],
};

export class McpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function venueConfig(venue, env = process.env) {
  if (!["kalshi", "polymarket"].includes(venue)) throw new McpError("configuration", "Unknown market-data venue.");
  const prefix = venue.toUpperCase();
  const endpoint = env[`${prefix}_MCP_URL`]?.trim() || (venue === "polymarket" ? POLYTRACKERS_URL : "");
  if (!endpoint) throw new McpError("configuration", `${prefix}_MCP_URL is required; configure an external market-data MCP server.`);
  let url;
  try { url = new URL(endpoint); } catch { throw new McpError("configuration", "MCP URL is invalid."); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash) {
    throw new McpError("configuration", "MCP URL must use HTTPS (HTTP is allowed on loopback), without credentials or query parameters.");
  }
  if (/(^|\.)docs\./i.test(url.hostname)) {
    throw new McpError("configuration", "Documentation MCPs cannot supply live contract data; configure a market-data MCP.");
  }
  const polytrackers = url.href.replace(/\/$/, "") === POLYTRACKERS_URL;
  // Never forward a PolyTrackers key to a custom endpoint by implicit fallback.
  const token = (env[`${prefix}_MCP_TOKEN`] || (polytrackers ? env.POLYTRACKERS_API_KEY : ""))?.trim();
  return { venue, url, token, polytrackers, provider: polytrackers ? "PolyTrackers" : "External MCP",
    configured: polytrackers ? Boolean(token) : true };
}

// Polymarket is enabled by default; Kalshi research remains opt-in via an explicit URL.
export function researchVenues(env = process.env) {
  return [...(env.KALSHI_MCP_URL?.trim() ? ["kalshi"] : []), "polymarket"];
}

export function researchStatus(env = process.env) {
  const servers = researchVenues(env).map((venue) => {
    try {
      const config = venueConfig(venue, env);
      return { venue, provider: config.provider, configured: config.configured, mode: "external" };
    } catch { return { venue, configured: false, mode: "external" }; }
  });
  return { configured: Boolean(env.GEMINI_API_KEY && servers.some((server) => server.configured)), servers };
}

export function allowedTools(venue, tools, env = process.env) {
  const config = venueConfig(venue, env);
  const configured = env[`${venue.toUpperCase()}_MCP_TOOLS`];
  const names = new Set(configured ? configured.split(",").map((name) => name.trim()).filter(Boolean)
    : config.polytrackers ? POLYTRACKERS_TOOLS : DEFAULT_TOOLS[venue]);
  return tools.filter((tool) => names.has(tool.name)
    // Provider presets may only be narrowed, never expanded to account or write tools.
    && (!config.polytrackers || POLYTRACKERS_TOOLS.includes(tool.name))
    && tool.annotations?.destructiveHint !== true && tool.annotations?.readOnlyHint !== false
    && !/(^|[_.-])(create|place|submit|cancel|delete|execute|transfer|withdraw|buy|sell|trade|update)([_.-]|$)/i.test(tool.name)
    && JSON.stringify(tool.inputSchema || {}).length <= 16000).slice(0, 24);
}

// Share provider pacing across simultaneous chats within this Node process.
const budgets = new Map();
export function polytrackersFetch(token, fetchFn = fetch) {
  const key = createHash("sha256").update(token).digest("hex");
  if (!budgets.has(key)) budgets.set(key, { tail: Promise.resolve(), started: 0, blockedUntil: 0 });
  const budget = budgets.get(key);
  return (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "POST") return fetchFn(request);
    const pending = budget.tail.then(async () => {
      request.signal.throwIfAborted();
      if (budget.blockedUntil > Date.now()) throw new McpError("rate_limited", "Polymarket research is rate limited. Try again later.");
      const pause = Math.max(0, 250 - (Date.now() - budget.started));
      if (pause) await delay(pause, undefined, { signal: request.signal });
      budget.started = Date.now();
      const response = await fetchFn(request);
      if (response.status === 401 || response.status === 403) {
        throw new McpError("authentication", "PolyTrackers rejected the research key. Check its validity and signals:read scope.");
      }
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const seconds = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) : null;
        const until = seconds != null ? Date.now() + seconds * 1000 : Date.parse(retry);
        budget.blockedUntil = Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60000;
        throw new McpError("rate_limited", "Polymarket research is rate limited. Try again later.");
      }
      return response;
    });
    budget.tail = pending.catch(() => {});
    return pending;
  };
}

function capabilityData(result) {
  if (result.isError) throw new McpError("capabilities", "PolyTrackers could not verify research capabilities for this key.");
  let data = result.structuredContent;
  if (!data) {
    try { data = JSON.parse(result.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n")); }
    catch { throw new McpError("capabilities", "PolyTrackers returned unreadable research capabilities."); }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new McpError("capabilities", "PolyTrackers returned invalid research capabilities.");
  return data;
}

export async function connectVenue(venue, { signal, env = process.env } = {}) {
  const config = venueConfig(venue, env);
  if (!config.configured) throw new McpError("missing_key", "Set POLYMARKET_MCP_TOKEN to a PolyTrackers Agent API Key with signals:read scope.");
  const client = new Client({ name: "edge-research-chat", version: "1.0.0" }, { listMaxPages: 5 });
  const options = { requestInit: { headers: config.token ? { Authorization: `Bearer ${config.token}` } : {} } };
  if (config.polytrackers) options.fetch = polytrackersFetch(config.token);
  const transport = new StreamableHTTPClientTransport(config.url, options);
  try {
    await client.connect(transport, { timeout: 8000, signal });
    const listed = await client.listTools({}, { timeout: 8000, signal });
    let tools = allowedTools(venue, listed.tools, env);
    let capabilities;
    if (config.polytrackers) {
      if (!listed.tools.some((tool) => tool.name === "pt_mcp_capabilities_get")) {
        throw new McpError("capabilities", "PolyTrackers did not expose its required capabilities tool.");
      }
      // Always check the key's tier/scopes before giving the model research tools.
      const data = capabilityData(await client.callTool({ name: "pt_mcp_capabilities_get", arguments: {} }, { timeout: 15000, signal }));
      const scopes = Array.isArray(data.caller?.scopes) ? data.caller.scopes : [];
      const tier = String(data.caller?.tier || "").toLowerCase();
      if (!scopes.includes("signals:read")) throw new McpError("authentication", "The PolyTrackers key must have signals:read scope.");
      const ranks = { free: 0, pro: 1, elite: 2 };
      const requirements = Array.isArray(data.tools) ? data.tools : Object.entries(data.tools || {}).map(([name, value]) => ({ ...value, name }));
      tools = tools.filter((tool) => {
        const required = requirements.find((entry) => entry.name === tool.name);
        if (required?.requiredScope && !scopes.includes(required.requiredScope)) return false;
        if (required?.requiredTier && (ranks[tier] == null || ranks[String(required.requiredTier).toLowerCase()] == null
          || ranks[tier] < ranks[String(required.requiredTier).toLowerCase()])) return false;
        // Documented Pro+ tool, even if a provider response omits its requirement.
        return tool.name !== "pt_market_trades_get" || ["pro", "elite"].includes(tier);
      });
      capabilities = { tier, scopes: scopes.filter((scope) => scope === "signals:read") };
    }
    if (!tools.some((tool) => tool.name !== "pt_mcp_capabilities_get")) throw new McpError("no_tools", "No allowed market research tools are available for this key.");
    return {
      venue, provider: config.provider, mode: "external", tools, capabilities,
      initialToolCalls: config.polytrackers ? [{ venue, tool: "pt_mcp_capabilities_get", arguments: {},
        status: "success", sources: [], evidence: JSON.stringify(capabilities) }] : [],
      call: (name, args) => {
        if (!tools.some((tool) => tool.name === name)) throw new McpError("not_allowed", "Tool is not allowed.");
        return client.callTool({ name, arguments: args }, { timeout: 15000, signal });
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}
