import { NextResponse } from "next/server";
import {
  callTool,
  initializeResult,
  listToolsResult,
  MARKET_CONTEXT_TOOL,
} from "../../../../lib/mcp";

export const dynamic = "force-dynamic";

function rpcResult(id, result) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function rpcError(id, code, message) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    },
    { status: code === -32601 ? 404 : 400 },
  );
}

export async function GET() {
  return NextResponse.json({
    name: "kalshi-polymarket-arb",
    transport: "http-json-rpc",
    endpoint: "/api/mcp",
    tools: [MARKET_CONTEXT_TOOL],
    example: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "market_context",
        arguments: {
          question: "What is the best arbitrage opportunity?",
        },
      },
    },
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  if (!body.jsonrpc && body.question) {
    const result = await callTool("market_context", {
      question: body.question,
      includeRawScan: body.includeRawScan,
    });
    return NextResponse.json(result.structuredContent);
  }

  const id = body.id ?? null;

  try {
    if (body.method === "initialize") {
      return rpcResult(id, initializeResult());
    }

    if (body.method === "tools/list") {
      return rpcResult(id, listToolsResult());
    }

    if (body.method === "tools/call") {
      const name = body.params?.name;
      const args = body.params?.arguments || {};
      return rpcResult(id, await callTool(name, args));
    }

    return rpcError(id, -32601, `method not found: ${body.method}`);
  } catch (error) {
    return rpcError(id, -32000, error.message);
  }
}
