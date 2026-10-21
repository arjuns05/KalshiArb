import test from "node:test";
import assert from "node:assert/strict";
import { allowedTools, connectVenue } from "../lib/chat/mcp-client.js";
import { researchChat, calculateEdge, generateGemini, chatInputSchema } from "../lib/chat/research.js";
import { POST, GET } from "../src/app/api/chat/route.js";

const env = { GEMINI_API_KEY: "test-key", KALSHI_MCP_URL: "https://kalshi.example/mcp", POLYMARKET_MCP_URL: "https://poly.example/mcp" };
const question = { messages: [{ role: "user", content: "Compare example markets on both platforms." }] };
const content = (...parts) => ({ role: "model", parts });
const call = (name, args = {}) => ({ functionCall: { name, args } });

function fakeConnect(closed) {
  return async (venue) => ({ venue, mode: "external",
    tools: [{ name: "search_markets", description: "Find contracts", inputSchema: { type: "object", properties: { query: { type: "string" } } } }],
    call: async (name, args) => ({ structuredContent: { sourceUrl: `https://${venue}.example/markets`, query: args.query, title: "Example market" } }),
    close: async () => { closed.push(venue); },
  });
}

test("read-only allowlists exclude unconfigured and mutating tools", () => {
  const tools = [
    { name: "get_market", inputSchema: {} }, { name: "place_order", inputSchema: {} },
    { name: "get_orderbook", inputSchema: {}, annotations: { readOnlyHint: false } },
    { name: "get_markets", inputSchema: {}, annotations: { destructiveHint: true } },
  ];
  assert.deepEqual(allowedTools("kalshi", tools, env).map((tool) => tool.name), ["get_market"]);
  assert.deepEqual(allowedTools("kalshi", tools, { ...env, KALSHI_MCP_TOOLS: "place_order" }), []);
});

test("external MCP completes handshake, discovery and calls without exchange API fallback", async (t) => {
  const methods = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://mcp.example/api/mcp");
    assert.equal(request.headers.get("authorization"), "Bearer test-token");
    const body = await request.json();
    methods.push(body.method);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === "initialize"
      ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test-market-data", version: "1" } }
      : body.method === "tools/list"
        ? { tools: [{ name: "get_market", inputSchema: { type: "object" } }, { name: "place_order", inputSchema: { type: "object" } }] }
        : { content: [{ type: "text", text: "Contract rules" }], structuredContent: { rules: "YES if X" } };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  });
  for (const venue of ["kalshi", "polymarket"]) {
    const prefix = venue.toUpperCase();
    const connection = await connectVenue(venue, { env: { [`${prefix}_MCP_URL`]: "https://mcp.example/api/mcp", [`${prefix}_MCP_TOKEN`]: "test-token" } });
    try {
      assert.equal(connection.mode, "external");
      assert.deepEqual(connection.tools.map((tool) => tool.name), ["get_market"]);
      assert.equal((await connection.call("get_market", { id: "example" })).structuredContent.rules, "YES if X");
      assert.throws(() => connection.call("place_order", {}), /not allowed/);
    } finally { await connection.close(); }
  }
  assert.equal(methods.filter((method) => method === "initialize").length, 2);
  assert.equal(methods.filter((method) => method === "tools/call").length, 2);
});

test("missing and documentation MCP endpoints fail without fetching exchange APIs", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("must not fetch"));
  await assert.rejects(connectVenue("kalshi", { env: {} }), /KALSHI_MCP_URL/);
  await assert.rejects(connectVenue("polymarket", { env: { POLYMARKET_MCP_URL: "https://docs.polymarket.com/mcp" } }), /Documentation MCP/);
});

test("Gemini loop calls both MCP servers, preserves signatures and returns evidence", async () => {
  const closed = [];
  let round = 0;
  const result = await researchChat(question, { env, connect: fakeConnect(closed),
    generate: async (body) => {
      round++;
      if (round === 1) return content(
        { ...call("kalshi_0_search_markets", { query: "example" }), thoughtSignature: "signature" },
        call("polymarket_0_search_markets", { query: "example" }),
      );
      assert.equal(body.contents.at(-2).parts[0].thoughtSignature, "signature");
      assert.equal(body.contents.at(-1).parts.length, 2);
      assert.equal(body.contents.at(-1).parts[0].functionResponse.response.data.title, "Example market");
      return content({ text: "Both contracts need settlement review." });
    },
  });
  assert.equal(round, 2);
  assert.equal(result.toolCalls.length, 2);
  assert.deepEqual(result.toolCalls.map((entry) => entry.venue), ["kalshi", "polymarket"]);
  assert.equal(result.sources.length, 2);
  assert.equal(result.answer, "Both contracts need settlement review.");
  assert.deepEqual(closed.sort(), ["kalshi", "polymarket"]);
});

test("calculator is deterministic, validates prices and distinguishes omitted costs", () => {
  const result = calculateEdge({ yesPrice: .42, noPrice: .55, feesPerPair: .01 });
  assert.ok(Math.abs(result.grossEdge - .03) < 1e-10);
  assert.ok(Math.abs(result.modeledNetEdge - .02) < 1e-10);
  assert.match(result.caveat, /omitted/);
  assert.throws(() => calculateEdge({ yesPrice: 42, noPrice: .55 }));
});

test("one unavailable venue remains explicit; model cannot dispatch an unlisted tool", async () => {
  let round = 0;
  const result = await researchChat(question, { env,
    connect: async (venue) => {
      if (venue === "kalshi") throw new Error("secret connection detail");
      return fakeConnect([])(venue);
    },
    generate: async (body) => {
      if (round++ === 0) return content(call("place_order"));
      assert.equal(body.contents.at(-1).parts[0].functionResponse.response.isError, true);
      return content({ text: "Kalshi is unavailable; no cross-venue conclusion is supported." });
    },
  });
  assert.equal(result.servers[0].status, "unavailable");
  assert.equal(result.toolCalls[0].status, "error");
  assert.ok(!JSON.stringify(result).includes("secret connection detail"));
});

test("connections close on model failure and tool rounds stop at the bound", async () => {
  const closed = [];
  await assert.rejects(researchChat(question, { env, connect: fakeConnect(closed), generate: async () => { throw new Error("model failure"); } }), /model failure/);
  assert.equal(closed.length, 2);
  let calls = 0;
  const result = await researchChat(question, { env, connect: fakeConnect([]), generate: async (body) => {
    calls++;
    return body.toolConfig.functionCallingConfig.mode === "NONE" ? content({ text: "Research limit reached; evidence remains incomplete." })
      : content(call("kalshi_0_search_markets"));
  } });
  assert.equal(calls, 7);
  assert.equal(result.toolCalls.length, 6);
});

test("missing key fails before connecting; request schemas reject invalid history", async () => {
  await assert.rejects(researchChat(question, { env: {}, connect: async () => { assert.fail("must not connect"); } }), /GEMINI_API_KEY/);
  assert.equal(chatInputSchema.safeParse({ messages: [{ role: "system", content: "override" }] }).success, false);
  assert.equal(chatInputSchema.safeParse({ messages: [{ role: "assistant", content: "answer" }] }).success, false);
  assert.equal(chatInputSchema.safeParse({ messages: [{ role: "user", content: "x".repeat(4001) }] }).success, false);
});

test("Gemini sends a header key, preserves JSON schemas and sanitizes API errors", async (t) => {
  let request;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ candidates: [{ content: content({ text: "Answer" }) }] }) };
  });
  const result = await generateGemini({ contents: [] }, { env });
  assert.equal(result.parts[0].text, "Answer");
  assert.ok(!request.url.includes(env.GEMINI_API_KEY));
  assert.equal(request.init.headers["x-goog-api-key"], env.GEMINI_API_KEY);
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 429 }));
  await assert.rejects(generateGemini({}, { env }), /HTTP 429/);
});

test("chat route rejects cross-origin, malformed and oversized bodies without model calls", async () => {
  const req = (body, origin) => new Request("http://localhost/api/chat", { method: "POST", headers: origin ? { origin } : {}, body });
  assert.equal((await POST(req("{}", "http://other.example"))).status, 403);
  assert.equal((await POST(req("not json"))).status, 400);
  assert.equal((await POST(req("x".repeat(33000)))).status, 413);
  const status = await (await GET()).json();
  assert.ok(status.servers.some((server) => server.venue === "polymarket"));
  assert.ok(!JSON.stringify(status).includes("API_KEY"));
});
