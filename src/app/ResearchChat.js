"use client";

import { useEffect, useRef, useState } from "react";

const suggestions = [
  "Find Bitcoin markets on Polymarket and explain their settlement rules.",
  "What evidence do I need to verify a cross-venue arbitrage candidate?",
];

export default function ResearchChat({ candidate }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const controller = useRef(null);
  const end = useRef(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/chat", { signal: abort.signal }).then((response) => {
      if (!response.ok) throw new Error();
      return response.json();
    }).then(setConfig).catch((failure) => {
      if (failure.name !== "AbortError") setError("Could not load research chat status. Refresh to try again.");
    });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);

  useEffect(() => { if (messages.length || pending) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages, pending]);

  async function ask(event) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    const next = [...messages, { role: "user", content: question.trim() }];
    setMessages(next);
    setQuestion("");
    setPending(true);
    setError(null);
    controller.current = new AbortController();
    try {
      let history = next.map(({ role, content }) => ({ role, content })).slice(-12);
      if (history[0]?.role === "assistant") history = history.slice(1);
      const response = await fetch("/api/chat", {
        method: "POST", signal: controller.current.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Research request failed.");
      setMessages((current) => [...current, { role: "assistant", content: data.answer,
        toolCalls: data.toolCalls, servers: data.servers, sources: data.sources }]);
    } catch (failure) {
      setError(failure.name === "AbortError" ? "Research stopped." : failure.message);
    } finally { setPending(false); controller.current = null; }
  }

  return (
    <section className="research-chat" aria-labelledby="research-title">
      <div className="research-heading">
        <div>
          <p className="eyebrow">On-demand research</p>
          <h2 id="research-title">Ask about a market</h2>
          <p>Research Polymarket contracts, settlement rules, prices, and market context through PolyTrackers.</p>
        </div>
        <button className="chat-secondary" type="button" disabled={pending || !messages.length}
          onClick={() => { setMessages([]); setError(null); }}>New chat</button>
      </div>
      {config?.configured && <p className="chat-empty">Polymarket research is configured. Provider availability is checked when you ask a question.</p>}
      {config?.configured === false && <p className="chat-notice">Research chat is not configured. Ask the administrator to configure the AI service and a PolyTrackers research key.</p>}
      <div className="chat-suggestions">
        {candidate && <button type="button" disabled={pending} onClick={() => setQuestion(
          `Research this cross-venue candidate: ${candidate.markets.map((market) => `${market.venue} contract ${market.id}, ${market.title}, ${market.side} ask $${market.price}`).join("; ")}. Research the Polymarket contract through MCP and identify any missing evidence. Use local contract details for the Kalshi comparison if available; do not claim a Kalshi MCP connection. Compare settlement rules and identify missing fee, depth or timing evidence.`
        )}>Research current candidate</button>}
        {suggestions.map((prompt) => <button key={prompt} type="button" disabled={pending}
          onClick={() => setQuestion(prompt)}>{prompt}</button>)}
      </div>
      <div className="chat-transcript" role="log" aria-label="Research conversation" aria-live="polite" aria-busy={pending}>
        {!messages.length && <p className="chat-empty">Ask a specific question to start. Market data is retrieved when needed; answers include the tools used and their sources.</p>}
        {messages.map((message, index) => (
          <article className={`chat-message chat-${message.role}`} key={index}>
            <strong>{message.role === "user" ? "You" : "Research assistant"}</strong>
            <p>{message.content}</p>
            {message.servers?.some((server) => server.status !== "connected") && <p className="chat-notice">Some market data was unavailable: {message.servers.filter((server) => server.status !== "connected").map((server) => server.venue).join(", ")}.</p>}
            {message.role === "assistant" && (
              <details className="chat-evidence">
                <summary>{message.toolCalls?.length || 0} tool calls · View evidence</summary>
                {!message.toolCalls?.length && <p>No market tools were called for this answer.</p>}
                {message.toolCalls?.map((call, callIndex) => <div key={callIndex}>
                  <strong>{call.venue} / {call.tool} · {call.status}</strong>
                  <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                  <pre>{call.evidence}</pre>
                </div>)}
              </details>
            )}
            {!!message.sources?.length && <ul className="chat-sources" aria-label="Sources">
              {message.sources.filter((url) => /^https?:\/\//.test(url)).map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}
            </ul>}
          </article>
        ))}
        {pending && <p className="chat-loading">Researching your question… This may take up to 90 seconds.</p>}
        <div ref={end} />
      </div>
      {error && <p className="chat-notice" role="alert">{error}</p>}
      <form className="chat-form" onSubmit={ask}>
        <label htmlFor="market-question">Your question</label>
        <textarea id="market-question" value={question} onChange={(event) => setQuestion(event.target.value)}
          maxLength={4000} rows={3} disabled={pending}
          placeholder="Which contracts cover this event, and do their settlement conditions match?" />
        <div className="chat-form-footer">
          <span>Potential opportunities require settlement, fee, liquidity and fill checks.</span>
          {pending ? <button type="button" className="chat-secondary" onClick={() => controller.current?.abort()}>Stop</button>
            : <button className="context-button" type="submit" disabled={!question.trim() || !config?.configured}>Ask</button>}
        </div>
      </form>
    </section>
  );
}
