"use client";

import { useEffect, useState } from "react";
import MoneyInput from "./MoneyInput";

export default function ArbPanel({ canonicalMarket }) {
  const [budget, setBudget] = useState("100");
  const [includeFees, setIncludeFees] = useState(true);
  const [slippageBps, setSlippageBps] = useState("50"); // 0.50%
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runCalc() {
    if (!canonicalMarket?.id) {
      setResult(null);
      return;
    }
    setLoading(true);
    const res = await fetch("/api/arb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canonicalMarketId: canonicalMarket.id,
        budget: Number(budget || 0),
        includeFees,
        slippageBps: Number(slippageBps || 0)
      })
    });
    const data = await res.json();
    setResult(data);
    setLoading(false);
  }

  useEffect(() => {
    runCalc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalMarket?.id]);

  if (!canonicalMarket) return <div className="muted">Pick a market to calculate.</div>;

  return (
    <div>
      <div className="muted">
        <div><b>Event:</b> {canonicalMarket.eventName}</div>
        <div><b>Market:</b> {canonicalMarket.name}</div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <div className="col">
          <MoneyInput label="Budget ($)" value={budget} onChange={setBudget} />
        </div>
        <div className="col">
          <label>Slippage buffer (bps)</label>
          <input value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} />
          <div className="small">50 bps = 0.50% conservative adjustment</div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <label>
          <input
            type="checkbox"
            checked={includeFees}
            onChange={(e) => setIncludeFees(e.target.checked)}
            style={{ width: "auto", marginRight: 8 }}
          />
          Include fees (rough MVP model)
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={runCalc} disabled={loading}>
          {loading ? "Calculating…" : "Recalculate"}
        </button>
      </div>

      {!result ? null : result.error ? (
        <div style={{ marginTop: 14 }} className="muted">
          Error: {result.error}
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <span className={`badge ${result.isArb ? "ok" : "no"}`}>
            {result.isArb ? "✅ Arbitrage Found" : "❌ No Arbitrage"}
          </span>

          <div className="kpi"><b>Arb metric:</b> {result.sumImpliedProb.toFixed(6)} (needs &lt; 1)</div>
          <div className="kpi"><b>Guaranteed ROI:</b> {(result.roi * 100).toFixed(3)}%</div>
          <div className="kpi"><b>Guaranteed Profit:</b> ${result.guaranteedProfit.toFixed(2)}</div>

          <table className="table">
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Best Book</th>
                <th>Decimal Odds</th>
                <th>Stake ($)</th>
              </tr>
            </thead>
            <tbody>
              {result.legs.map((leg) => (
                <tr key={leg.outcomeName}>
                  <td>{leg.outcomeName}</td>
                  <td>{leg.bestBookName}</td>
                  <td>{leg.decimalOdds.toFixed(4)}</td>
                  <td>${leg.stake.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="small" style={{ marginTop: 10 }}>
            Note: This MVP ignores limits/liquidity. Add those once ingestion is wired.
          </div>
        </div>
      )}
    </div>
  );
}
