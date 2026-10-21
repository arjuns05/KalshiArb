import test from "node:test";
import assert from "node:assert/strict";
import { getMarkets, bestAsk, normalizePolymarket } from "../lib/markets.js";
import { computeArbitrage } from "../lib/arb.js";

const poly = { conditionId: "P1", question: "Example election winner", outcomes: '["No","Yes"]',
  outcomePrices: '["0.10","0.90"]', clobTokenIds: '["NO","YES"]' };
const kalshi = { ticker: "K1", title: "Example election winner", yes_ask_dollars: "0.40", no_ask_dollars: "0.70" };

test("scanner uses each outcome's order-book ask, not Gamma outcome prices", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/books")) {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), [{ token_id: "YES" }, { token_id: "NO" }]);
      return Response.json([
        { asset_id: "YES", timestamp: "123", asks: [{ price: "0.6", size: "20" }, { price: "0.5", size: "10" }] },
        { asset_id: "NO", timestamp: "124", asks: [{ price: "0.55", size: "10" }] },
      ]);
    }
    return Response.json(url.includes("kalshi") ? { markets: [kalshi] } : [poly]);
  });
  const result = await getMarkets();
  assert.equal(result.polymarket[0].yesAsk, .5);
  assert.equal(result.polymarket[0].noAsk, .55);
  assert.equal(result.polymarket[0].updatedAt, null);
  assert.equal(result.polymarket[0].quoteTimestamps.no, "124");
  assert.ok(Math.abs(computeArbitrage(result.kalshi, result.polymarket).best.edge - .05) < 1e-10);
});

test("failed or empty order books never fall back to indicative prices", async (t) => {
  for (const response of [() => new Response(null, { status: 503 }), () => Response.json([])]) {
    t.mock.method(globalThis, "fetch", async (url) => url.endsWith("/books") ? response()
      : Response.json(url.includes("kalshi") ? { markets: [kalshi] } : [poly]));
    const result = await getMarkets();
    assert.equal(result.kalshi.length, 1);
    assert.equal(result.polymarket.length, 0);
    assert.ok(result.failures.polymarket);
  }
});

test("binary outcome IDs and valid nonempty asks are required", () => {
  assert.equal(normalizePolymarket({ ...poly, outcomes: '["Up","Down"]' }), null);
  assert.equal(normalizePolymarket({ ...poly, clobTokenIds: '[]' }), null);
  assert.deepEqual(normalizePolymarket({ ...poly, version: "v2", positionIds: '["N2","Y2"]' }).assetIds, { yes: "Y2", no: "N2" });
  assert.equal(bestAsk({ asks: [{ price: ".2", size: "0" }, { price: "2", size: "10" }] }), null);
  assert.equal(computeArbitrage([{ yesAsk: null, noAsk: .5 }], []).best, null);
});
