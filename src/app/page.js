"use client";

import { useEffect, useMemo, useState } from "react";
import MarketPicker from "../../components/MarketPicker";
import ArbPanel from "../../components/ArbPanel";

export default function Page() {
  const [markets, setMarkets] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadMarkets() {
    setLoading(true);
    const res = await fetch("/api/canonical-markets", { cache: "no-store" });
    const data = await res.json();
    setMarkets(data.markets || []);
    if (!selectedId && data.markets?.[0]?.id) {
      setSelectedId(data.markets[0].id);
    }
    setLoading(false);
  }

  async function ingestNow() {
    const res = await fetch("/api/ingest", { method: "POST" });

    const text = await res.text(); // read raw body first
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      // not JSON (likely HTML error page)
    }

    if (!res.ok) {
      console.error("Ingest failed:", res.status, text);
      alert(`Ingest failed (${res.status}). Check console/server logs.`);
      return;
    }

    console.log("Ingest:", data);
    await loadMarkets();
  }

  useEffect(() => {
    loadMarkets();
  }, []);

  const selected = useMemo(
    () => markets.find((m) => m.id === selectedId) || null,
    [markets, selectedId]
  );

  return (
    <div>
      <h1>Kalshi × Polymarket Arbitrage MVP</h1>

      <div className="row">
        <div className="col card">
          <MarketPicker
            markets={markets}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            loading={loading}
          />

          <div style={{ marginTop: 12 }} className="muted">
            Live mode uses <code>KALSHI_API_BASE</code> and <code>POLYMARKET_GAMMA_BASE</code> from your env.
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={ingestNow}>Poll Once (Fetch Live Markets)</button>
            <button onClick={loadMarkets}>Refresh Markets</button>
          </div>

        </div>

        <div className="col card">
          <ArbPanel canonicalMarket={selected} />
        </div>
      </div>
    </div>
  );
}
