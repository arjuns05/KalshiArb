"use client";

import { useState } from "react";
import ResearchChat from "./ResearchChat";

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatPercent(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value) {
  if (!value) return "Unknown close";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown close";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function Dashboard() {
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);

  async function scanMarkets() {
    if (scanning) return;
    setScanning(true);
    setScanError(null);
    try {
      const response = await fetch("/api/arb", { cache: "no-store", signal: AbortSignal.timeout(45000) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.stats) throw new Error(data?.error || "Could not scan markets. Try again.");
      setResult(data);
    } catch (error) {
      setScanError(error.name === "TimeoutError" ? "The scan timed out. Try again." : error.message);
    } finally { setScanning(false); }
  }

  const best = result?.best;
  const failures = result?.failures || {};
  const stats = result?.stats || { kalshi: 0, polymarket: 0, matches: 0, opportunities: 0 };
  const hasFailure = failures.kalshi || failures.polymarket;
  const hasEdge = best && best.edge > 0;
  const totalMarkets = stats.kalshi + stats.polymarket;
  const updateLabel = result?.scannedAt ? new Date(result.scannedAt).toLocaleString() : "Not scanned yet";

  return (
    <main>
      <nav>
        <a className="brand" href="#top" aria-label="Edge home">
          <span className="brand-mark">E</span>
          <span>EDGE</span>
        </a>
        <div className="nav-status">
          <span className="status">
            <i />
            {scanning ? "Scanning markets…" : result ? (hasFailure ? "Partial market data" : "Market snapshot") : "Ready to scan"}
          </span>
        </div>
      </nav>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Prediction market arbitrage</p>
          <h1>Kalshi and Polymarket arb tracker</h1>
          <p className="intro">
            Scan Kalshi and Polymarket public prices to compare similar events.
            Results update when you request a new scan.
          </p>
          <button className="context-button" type="button" onClick={scanMarkets} disabled={scanning}>
            {scanning ? "Scanning markets…" : "Scan markets"}
          </button>
        </div>

        <div className="hero-panel" aria-label="Scan summary" aria-busy={scanning}>
          <div>
            <span>Markets scanned</span>
            <strong>{totalMarkets}</strong>
          </div>
          <div>
            <span>Matches found</span>
            <strong>{stats.matches}</strong>
          </div>
          <div>
            <span>Candidates</span>
            <strong>{stats.opportunities}</strong>
          </div>
          <div>
            <span>Last completed scan</span>
            <strong className="small-stat">{updateLabel}</strong>
          </div>

        </div>
      </section>

      {scanError && <p className="chat-notice" role="alert">{scanError} {result && "Previous results are still shown; check the last completed scan time."}</p>}
      {hasFailure && <div className="chat-notice" role="status">
        {Object.entries(failures).filter(([, message]) => message).map(([venue, message]) => <p key={venue}>{venue === "kalshi" ? "Kalshi" : "Polymarket"}: {message}</p>)}
      </div>}

      <section className="opportunity">
        <div className="opportunity-head">
          <div>
            <span className="live-pill">
              {hasEdge ? "Best candidate" : "Best quoted match"}
            </span>
            <h2>{best ? best.title : result ? "No comparable markets found" : "Scan markets to find candidates"}</h2>
            <p>
              {best
                ? `Matched market · Closes ${formatDate(best.closeTime)} · ${formatPercent(
                    best.score,
                  )} title match`
                : result ? "The scan did not return comparable contracts with available quotes." : "Start a scan to fetch prices from both exchanges."}
            </p>
          </div>
          <div className="opportunity-actions">
            <a className="context-button" href="#research-title">Research contracts</a>
            <div className="edge">
              <span>{hasEdge ? "Potential gross edge" : "Current gap"}</span>
              <strong className={hasEdge ? "" : "negative"}>
                {best ? formatPercent(best.edge) : "0.0%"}
              </strong>
              <small>settlement, fees and fills unverified</small>
            </div>
          </div>
        </div>

        {best ? (
          <>
            <div className="market-grid">
              {best.markets.map((market) => (
                <article className="market" key={`${market.venue}-${market.side}`}>
                  <div className="market-title">
                    <span className={`venue-icon ${market.color}`}>
                      {market.venue[0]}
                    </span>
                    <div>
                      <p>{market.venue}</p>
                      <span>
                        {market.venue === "Kalshi" ? "CFTC regulated" : "Crypto market"}
                      </span>
                    </div>
                  </div>
                  <div className="quote">
                    <span>Buy {market.side}</span>
                    <strong>{formatMoney(market.price)}</strong>
                  </div>
                </article>
              ))}
            </div>

            <div className="math">
              <div>
                <span>Total cost</span>
                <strong>{formatMoney(best.cost)}</strong>
              </div>
              <span className="operator">-&gt;</span>
              <div>
                <span>Payout if equivalent</span>
                <strong>$1.00</strong>
              </div>
              <span className="operator">=</span>
              <div className={hasEdge ? "profit" : "profit negative"}>
                <span>Gross edge per pair</span>
                <strong>
                  {best.edge >= 0 ? "+" : ""}
                  {formatMoney(best.edge)}
                </strong>
              </div>
            </div>

          </>
        ) : (
          <div className="empty-state">
            <strong>{result ? "No cross-venue match in this scan" : "Ready for your first scan"}</strong>
            <span>Click Scan markets to fetch current quotes.</span>
          </div>
        )}
      </section>

      <ResearchChat candidate={best} />

      <section className="stats" aria-label="Venue counts">
        <div>
          <span>Kalshi markets</span>
          <strong>{stats.kalshi}</strong>
        </div>
        <div>
          <span>Polymarket markets</span>
          <strong>{stats.polymarket}</strong>
        </div>
        <div>
          <span>Data status</span>
          <strong>{result ? (hasFailure ? "Partial" : "Snapshot") : "Not scanned"}</strong>
        </div>
      </section>

      <footer>
        <span>EDGE · Next.js, PostgreSQL, MCP, Gemini, Codex</span>
        <span>
          Kalshi {stats.kalshi} · Polymarket {stats.polymarket}
          {hasFailure ? " · One source unavailable" : ""}
        </span>
      </footer>
    </main>
  );
}
