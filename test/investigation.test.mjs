import test from "node:test";
import assert from "node:assert/strict";
import { computeArbitrage } from "../lib/arb.js";
import { findOpportunities, compareMarketPair, scanHistory } from "../lib/investigation.js";
import { getMarketDetails } from "../lib/markets.js";
import { getPool, getScanHistory } from "../lib/db.js";

const market = (id, venue, title, yesAsk, noAsk) => ({ id, venue, title, yesAsk, noAsk, closeTime: "2026-12-01T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" });
const scan = computeArbitrage(
  [market("K1", "Kalshi", "Example election winner", .4, .7)],
  [market("P1", "Polymarket", "Example election winner December", .4, .55)],
);

test("scan preserves both identities and filters positive edges in descending order", async () => {
  const result = await findOpportunities({ minEdge: .02, query: "DECEMBER", limit: 1 }, async () => scan);
  assert.equal(result.totalMatching, 1);
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].markets[0].id, "K1");
  assert.equal(result.opportunities[0].markets[1].id, "P1");
  assert.equal(result.opportunities[0].markets[1].updatedAt, "2026-10-20T00:00:00Z");
  assert.ok(result.scannedAt);
  assert.equal((await findOpportunities({ minMatchScore: 1 }, async () => scan)).totalMatching, 0);
  await assert.rejects(findOpportunities({ limit: 0 }));
  await assert.rejects(findOpportunities({ minEdge: 2 }));
});

test("pair inspection reports missing rules and date differences without certifying equivalence", async () => {
  const result = await compareMarketPair({ kalshiId: "K1", polymarketId: "P1" }, async (venue, id) => ({
    id, venue, title: "Example winner", closeTime: venue === "Kalshi" ? "2026-12-01T00:00:00Z" : "2026-12-02T00:00:00Z", rules: null,
  }));
  assert.equal(result.equivalence, "unverified");
  assert.equal(result.closeTimeDifferenceMs, 86400000);
  assert.ok(result.flags.some((flag) => flag.includes("resolution rules are missing")));
  assert.ok(result.flags.some((flag) => flag.includes("close times differ")));
});

test("pair lookup retains successful venue when the other fails", async () => {
  const result = await compareMarketPair({ kalshiId: "K1", polymarketId: "P1" }, async (venue) => {
    if (venue === "Kalshi") throw new Error("upstream unavailable");
    return { title: "Example winner" };
  });
  assert.equal(result.kalshi, null);
  assert.ok(result.polymarket);
  assert.equal(result.failures.kalshi, "upstream unavailable");
  assert.equal(result.titleMatchScore, null);
});

test("contract details use fixed API hosts, include rules and work without quotes", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return { ok: true, json: async () => url.includes("kalshi")
      ? { market: { ticker: "K/1", title: "Example", rules_primary: "Primary", rules_secondary: "Secondary" } }
      : [{ conditionId: "0x123", question: "Example", description: "YES if X", resolutionSource: "Official source" }] };
  });
  const kalshi = await getMarketDetails("Kalshi", "K/1");
  const poly = await getMarketDetails("Polymarket", "0x123");
  assert.match(urls[0], /K%2F1$/);
  assert.match(urls[1], /condition_ids=0x123/);
  assert.equal(kalshi.rules, "Primary\n\nSecondary");
  assert.equal(poly.rules, "YES if X");
  assert.equal(poly.resolutionSource, "Official source");
  await assert.rejects(getMarketDetails("Polymarket", "missing"), /not found/);
});

test("history validates ranges, defaults to a day, and reads with parameterized bounded SQL", async (t) => {
  const result = await scanHistory({ until: "2026-10-20T12:00:00Z", limit: 3 }, async (input) => {
    assert.equal(input.since, "2026-10-19T12:00:00.000Z");
    assert.equal(input.limit, 3);
    return { available: true, scans: [] };
  });
  assert.equal(result.available, true);
  await assert.rejects(scanHistory({ since: "2026-10-21T00:00:00Z", until: "2026-10-20T00:00:00Z" }), /since/);
  await assert.rejects(scanHistory({ since: "yesterday" }));
  const previousUrl = process.env.DATABASE_URL;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });
  process.env.DATABASE_URL = "postgres://localhost/test";
  const pool = getPool();
  t.mock.method(pool, "query", async (sql, values) => {
    assert.match(sql, /limit \$3/);
    assert.deepEqual(values, ["start", "end", 3]);
    return { rows: [{ best_edge: 0 }] };
  });
  assert.deepEqual((await getScanHistory({ since: "start", until: "end", limit: 3 })).scans, [{ best_edge: 0 }]);
  delete process.env.DATABASE_URL;
  assert.equal((await scanHistory()).available, false);
});

