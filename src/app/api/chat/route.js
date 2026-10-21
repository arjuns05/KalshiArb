import { researchStatus } from "../../../../lib/chat/mcp-client.js";
import { researchChat, ChatError, chatInputSchema } from "../../../../lib/chat/research.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
let activeRequests = 0;

export async function GET() {
  return Response.json(researchStatus());
}

async function readInput(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError("Request body is required.", 400);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32000) {
        await reader.cancel();
        throw new ChatError("Conversation is too large. Start a new chat.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = chatInputSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) throw new Error("Invalid messages");
    return parsed.data;
  } catch { throw new ChatError("Send up to 12 user/assistant messages, ending with a user question, with at most 4000 characters each and 24000 total.", 400); }
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin chat requests are not supported." }, { status: 403 });
  }
  if (activeRequests >= 2) return Response.json({ error: "Research chat is busy. Try again shortly." }, { status: 429 });
  activeRequests++;
  try {
    const input = await readInput(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90000)]);
    return Response.json(await researchChat(input, { signal }));
  } catch (error) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    return Response.json({ error: timedOut ? "Research timed out. Try a narrower question."
      : error instanceof ChatError ? error.message : "Research failed. Check the Gemini and MCP configuration, then try again." },
    { status: timedOut ? 504 : error instanceof ChatError ? error.status : 502 });
  } finally { activeRequests--; }
}
