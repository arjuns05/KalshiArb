import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/arb/route.js";

test("REST scans fetch fresh data and report partial source failure without caching", async (t) => {
  const savedUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    requests++;
    if (url.includes("polymarket")) throw new Error("Polymarket temporarily unavailable");
    return Response.json({ markets: [{ ticker: "K1", title: "Example election winner", yes_ask_dollars: ".4", no_ask_dollars: ".7" }] });
  });
  for (let scan = 0; scan < 2; scan++) {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.stats.kalshi, 1);
    assert.equal(result.stats.polymarket, 0);
    assert.equal(result.best, null);
    assert.equal(result.failures.polymarket, "Polymarket temporarily unavailable");
    assert.ok(result.scannedAt);
  }
  assert.equal(requests, 4);
});
