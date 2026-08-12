const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

async function scan() {
  const response = await fetch("http://localhost:3000/api/arb", {
    headers: { accept: "application/json" },
  });
  return response.json();
}

async function broadcast() {
  try {
    const result = await scan();
    const message = JSON.stringify({
      type: "arb_update",
      best: result.best,
      stats: result.stats,
      at: new Date().toISOString(),
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  } catch (error) {
    console.error("realtime scan failed", error.message);
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "connected" }));
});

setInterval(broadcast, 30000);

server.listen(process.env.WS_PORT || 4000, () => {
  console.log(`realtime server listening on ${process.env.WS_PORT || 4000}`);
});
