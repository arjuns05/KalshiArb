export const dynamic = "force-dynamic";

import { loadArbitrage } from "../../lib/arb";

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

export default async function Home() {
  const { best, failures, stats } = await loadArbitrage();
  const hasFailure = failures.kalshi || failures.polymarket;
  const hasEdge = best && best.edge > 0;
  const totalMarkets = stats.kalshi + stats.polymarket;

  return (
    <main>
      <nav>
        <a className="brand" href="#top" aria-label="Edge home">
          <span className="brand-mark">E</span>
          <span>EDGE</span>
        </a>
        <span className="status">
          <i />
          {hasFailure ? "Partial live data" : "Live public data"}
        </span>
      </nav>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Prediction market arbitrage</p>
          <h1>Kalshi and Polymarket arb tracker</h1>
          <p className="intro">
            Pulls public market prices, compares similar events, and shows the best
            Yes/No pair I found on the latest scan.
          </p>
        </div>

        <div className="hero-panel" aria-label="Scan summary">
          <div>
            <span>Markets scanned</span>
            <strong>{totalMarkets}</strong>
          </div>
          <div>
            <span>Matches found</span>
            <strong>{stats.matches}</strong>
          </div>
          <div>
            <span>Open arbs</span>
            <strong>{stats.opportunities}</strong>
          </div>
        </div>
      </section>

      <section className="opportunity">
        <div className="opportunity-head">
          <div>
            <span className="live-pill">
              {hasEdge ? "Best opportunity" : "Best live match"}
            </span>
            <h2>{best ? best.title : "No comparable live markets found"}</h2>
            <p>
              {best
                ? `Matched market · Closes ${formatDate(best.closeTime)} · ${formatPercent(
                    best.score,
                  )} title match`
                : "Fetched public markets did not produce a confident cross-venue match."}
            </p>
          </div>
          <div className="edge">
            <span>{hasEdge ? "Guaranteed edge" : "Current gap"}</span>
            <strong className={hasEdge ? "" : "negative"}>
              {best ? formatPercent(best.edge) : "0.0%"}
            </strong>
            <small>before fees and fill risk</small>
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
                      <span>{market.venue === "Kalshi" ? "CFTC regulated" : "Crypto market"}</span>
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
                <span>Guaranteed payout</span>
                <strong>$1.00</strong>
              </div>
              <span className="operator">=</span>
              <div className={hasEdge ? "profit" : "profit negative"}>
                <span>Profit per contract</span>
                <strong>
                  {best.edge >= 0 ? "+" : ""}
                  {formatMoney(best.edge)}
                </strong>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <strong>Waiting for a cross-venue match</strong>
            <span>Refresh after more public markets are available.</span>
          </div>
        )}
      </section>

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
          <strong>{hasFailure ? "Partial" : "Live"}</strong>
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
