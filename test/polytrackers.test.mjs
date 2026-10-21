import test from "node:test";
import assert from "node:assert/strict";
import { allowedTools, connectVenue, venueConfig, researchStatus, researchVenues, polytrackersFetch, McpError, POLYTRACKERS_URL } from "../lib/chat/mcp-client.js";
import { researchChat } from "../lib/chat/research.js";

const schema = { type: "object", properties: { query: { type: "string" } } };
const tool = (name, annotations) => ({ name, description: "Research tool", inputSchema: schema, ...(annotations ? { annotations } : {}) });
const question = { messages: [{ role: "user", content: "Find a Bitcoin contract on Polymarket." }] };

test("default research is Polymarket only; readiness requires the model and provider key", () => {
  assert.deepEqual(researchVenues({}), ["polymarket"]);
  assert.equal(venueConfig("polymarket", {}).url.href, POLYTRACKERS_URL);
  assert.equal(researchStatus({ GEMINI_API_KEY: "model" }).configured, false);
  const env = { GEMINI_API_KEY: "model", POLYTRACKERS_API_KEY: "provider-secret" };
  assert.equal(researchStatus(env).configured, true);
  assert.equal(researchStatus(env).servers[0].provider, "PolyTrackers");
  assert.ok(!JSON.stringify(researchStatus(env)).includes("provider-secret"));
  const custom = venueConfig("polymarket", { ...env, POLYMARKET_MCP_URL: "https://custom.example/mcp" });
  assert.equal(custom.token, "");
  assert.equal(custom.polytrackers, false);
  assert.throws(() => venueConfig("polymarket", { POLYMARKET_MCP_URL: "http://public.example/mcp" }), /HTTPS/);
});

test("provider allowlist cannot be expanded to private account, scan, mock or trading tools", () => {
  const names = ["pt_markets_search", "pt_market_intel_get", "pt_clob_price_get", "pt_account_get", "pt_scan_trigger", "pt_mock_price_get", "pt_trade_execute", "pt_api_keys_list"];
  const env = { POLYMARKET_MCP_TOOLS: names.join(",") };
  assert.deepEqual(allowedTools("polymarket", names.map((name) => tool(name)), env).map((item) => item.name), names.slice(0, 3));
  assert.deepEqual(allowedTools("polymarket", [tool("pt_markets_search", { readOnlyHint: false })], {}), []);
});

test("PolyTrackers MCP discovers real schemas, checks capabilities first and omits Pro-only tools on Free", async (t) => {
  const methods = [];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, POLYTRACKERS_URL);
    assert.equal(request.headers.get("authorization"), "Bearer ptk_fixture_discovery");
    const body = await request.json();
    methods.push(body.method);
    if (body.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (body.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "PolyTrackers fixture", version: "1" } };
    if (body.method === "tools/list") result = { tools: ["pt_mcp_capabilities_get", "pt_markets_search", "pt_market_intel_get", "pt_market_trades_get", "pt_trade_execute", "pt_account_get"].map((name) => tool(name)) };
    if (body.method === "tools/call") {
      calls.push(body.params.name);
      result = { content: [{ type: "text", text: "Evidence" }], structuredContent: body.params.name === "pt_mcp_capabilities_get"
        ? { caller: { tier: "free", scopes: ["signals:read"] }, tools: [{ name: "pt_market_intel_get", requiredTier: "elite" }] }
        : { markets: [{ conditionId: "P1", sourceUrl: "https://polymarket.com/event/example" }] } };
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  });
  const connection = await connectVenue("polymarket", { env: { POLYMARKET_MCP_TOKEN: "ptk_fixture_discovery" } });
  try {
    assert.deepEqual(connection.tools.map((item) => item.name), ["pt_mcp_capabilities_get", "pt_markets_search"]);
    assert.equal(connection.capabilities.tier, "free");
    assert.deepEqual(calls, ["pt_mcp_capabilities_get"]);
    const result = await connection.call("pt_markets_search", { query: "Bitcoin" });
    assert.equal(result.structuredContent.markets[0].conditionId, "P1");
    assert.throws(() => connection.call("pt_trade_execute", {}), /not allowed/);
    assert.deepEqual(calls, ["pt_mcp_capabilities_get", "pt_markets_search"]);
    assert.ok(methods.includes("initialize") && methods.includes("tools/list"));
  } finally { await connection.close(); }
});

test("provider capabilities can be JSON text; missing read scope fails closed", async (t) => {
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const body = await new Request(input, init).json();
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === "initialize"
      ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : body.method === "tools/list" ? { tools: [tool("pt_mcp_capabilities_get"), tool("pt_markets_search")] }
        : { content: [{ type: "text", text: JSON.stringify({ caller: { tier: "pro", scopes: [] } }) }] };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  });
  await assert.rejects(connectVenue("polymarket", { env: { POLYMARKET_MCP_TOKEN: "ptk_fixture_scope" } }), /signals:read/);
});

test("missing key fails before network access and surfaces an actionable error", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("must not fetch"));
  await assert.rejects(connectVenue("polymarket", { env: {} }), /POLYMARKET_MCP_TOKEN/);
  await assert.rejects(researchChat(question, { env: { GEMINI_API_KEY: "fixture" }, generate: () => assert.fail("must not call model") }), /PolyTrackers Agent API Key/);
});

test("provider requests serialize across chats, respect Retry-After and sanitize auth errors", async () => {
  let active = 0;
  let calls = 0;
  const run = polytrackersFetch("ptk_fixture_pacing", async () => {
    active++;
    calls++;
    assert.equal(active, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return Response.json({ ok: true });
  });
  const input = () => new Request(POLYTRACKERS_URL, { method: "POST", body: "{}" });
  await Promise.all([run(input()), run(input())]);
  assert.equal(calls, 2);
  let limitedCalls = 0;
  const limited = polytrackersFetch("ptk_fixture_limited", async () => {
    limitedCalls++;
    return new Response("private upstream body", { status: 429, headers: { "retry-after": "60" } });
  });
  for (let index = 0; index < 2; index++) await assert.rejects(limited(input()), (error) => error instanceof McpError && error.code === "rate_limited" && !error.message.includes("private"));
  assert.equal(limitedCalls, 1);
  const denied = polytrackersFetch("ptk_fixture_denied", async () => new Response("secret", { status: 401 }));
  await assert.rejects(denied(input()), (error) => error.code === "authentication" && !error.message.includes("secret"));
});

test("Polymarket-only conversation dispatches provider tools and returns source evidence", async () => {
  const venues = [];
  let closed = false;
  let round = 0;
  const result = await researchChat(question, { env: { GEMINI_API_KEY: "fixture" },
    connect: async (venue) => {
      venues.push(venue);
      return { venue, provider: "PolyTrackers", mode: "external", capabilities: { tier: "free", scopes: ["signals:read"] },
        tools: [tool("pt_markets_search")],
        call: async (name, args) => {
          assert.equal(name, "pt_markets_search");
          assert.equal(args.query, "Bitcoin");
          return { structuredContent: { sourceUrl: "https://polymarket.com/event/example", conditionId: "P1" } };
        }, close: async () => { closed = true; } };
    },
    generate: async (body) => {
      if (round++ === 0) return { role: "model", parts: [{ functionCall: { name: "polymarket_0_pt_markets_search", args: { query: "Bitcoin" } } }] };
      assert.equal(body.contents.at(-1).parts[0].functionResponse.response.data.conditionId, "P1");
      return { role: "model", parts: [{ text: "Contract P1 needs settlement review." }] };
    },
  });
  assert.deepEqual(venues, ["polymarket"]);
  assert.equal(result.servers.length, 1);
  assert.equal(result.servers[0].provider, "PolyTrackers");
  assert.deepEqual(result.sources, ["https://polymarket.com/event/example"]);
  assert.ok(closed);
});
