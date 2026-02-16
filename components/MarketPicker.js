export default function MarketPicker({ markets, selectedId, setSelectedId, loading }) {
  return (
    <div>
      <label>Canonical Market</label>
      {loading ? (
        <div className="muted">Loading…</div>
      ) : markets.length === 0 ? (
        <div className="muted">No live markets yet. Check API keys and run fetch.</div>
      ) : (
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.eventName} — {m.name}
            </option>
          ))}
        </select>
      )}

      <div className="small" style={{ marginTop: 8 }}>
        MVP supports <b>two-outcome</b> markets only.
      </div>
    </div>
  );
}
