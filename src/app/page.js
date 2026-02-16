"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import MarketPicker from "../../components/MarketPicker";
import ArbPanel from "../../components/ArbPanel";

export default function Page() {
  const [markets, setMarkets] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pollStatus, setPollStatus] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const eventSourceRef = useRef(null);

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

  async function triggerPoll() {
    try {
      const res = await fetch("/api/polling/status", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        console.log("Manual poll triggered:", data.result);
        // Reload markets after a short delay to allow ingestion to complete
        setTimeout(() => loadMarkets(), 1000);
      }
    } catch (err) {
      console.error("Failed to trigger poll:", err);
    }
  }

  async function loadPollStatus() {
    try {
      const res = await fetch("/api/polling/status");
      const data = await res.json();
      if (data.ok) {
        setPollStatus(data);
      }
    } catch (err) {
      console.error("Failed to load poll status:", err);
    }
  }

  useEffect(() => {
    loadMarkets();
    loadPollStatus();

    // Set up Server-Sent Events for live updates
    const eventSource = new EventSource("/api/polling/stream");
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === "connected") {
          console.log("Connected to polling stream");
        } else if (data.type === "poll_update") {
          console.log("Poll update received:", data);
          setLastUpdate({
            timestamp: data.timestamp,
            duration: data.duration,
            summary: data.summary,
            fetched: data.fetched
          });
          
          // Reload markets when new data arrives
          if (data.summary && data.summary.createdQuotes > 0) {
            setTimeout(() => loadMarkets(), 500);
          }
          
          // Update poll status
          loadPollStatus();
        }
      } catch (err) {
        console.error("Error parsing SSE message:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE error:", err);
      // Attempt to reconnect after a delay
      setTimeout(() => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = new EventSource("/api/polling/stream");
        }
      }, 5000);
    };

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const selected = useMemo(
    () => markets.find((m) => m.id === selectedId) || null,
    [markets, selectedId]
  );

  return (
    <div>
      <h1>Kalshi × Sportsbook Arbitrage MVP</h1>

      {/* Polling Status Indicator */}
      {pollStatus && (
        <div style={{ 
          padding: "8px 12px", 
          marginBottom: "16px", 
          backgroundColor: pollStatus.enabled ? "#e8f5e9" : "#fff3e0",
          border: `1px solid ${pollStatus.enabled ? "#4caf50" : "#ff9800"}`,
          borderRadius: "4px",
          fontSize: "14px"
        }}>
          <strong>Live Updates:</strong>{" "}
          {pollStatus.enabled ? (
            <>
              <span style={{ color: "#2e7d32" }}>●</span> Active
              {pollStatus.lastPollTime && (
                <> • Last poll: {new Date(pollStatus.lastPollTime).toLocaleTimeString()}</>
              )}
              {pollStatus.isPolling && <> • Polling now...</>}
            </>
          ) : (
            <span style={{ color: "#f57c00" }}>Disabled (set POLL_ENABLED=true)</span>
          )}
          {lastUpdate && (
            <span style={{ marginLeft: "12px", fontSize: "12px", color: "#666" }}>
              • {lastUpdate.fetched} markets fetched • {lastUpdate.summary?.createdQuotes || 0} new quotes
            </span>
          )}
        </div>
      )}

      <div className="row">
        <div className="col card">
          <MarketPicker
            markets={markets}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            loading={loading}
          />

          <div style={{ marginTop: 12 }} className="muted">
            Live mode uses <code>KALSHI_API_BASE</code> and <code>ODDS_API_KEY</code> from your env.
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={ingestNow}>Fetch Live Markets</button>
            <button onClick={triggerPoll}>Trigger Poll Now</button>
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
