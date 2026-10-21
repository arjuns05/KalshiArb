// Verifies external MCP research access. No model or trading calls.
import nextEnv from "@next/env";
import { connectVenue, researchVenues, McpError } from "../lib/chat/mcp-client.js";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const queryIndex = process.argv.indexOf("--query");
const query = queryIndex >= 0 ? process.argv[queryIndex + 1] : null;
if (queryIndex >= 0 && (!query || query.startsWith("--"))) {
  console.error("Usage: npm run check:mcp -- --query Bitcoin");
  process.exit(1);
}
for (const venue of researchVenues()) {
  let connection;
  try {
    connection = await connectVenue(venue, { signal: AbortSignal.timeout(30000) });
    console.log(`${venue}: connected to ${connection.provider}; allowed tools: ${connection.tools.map((tool) => tool.name).join(", ")}`);
    if (connection.capabilities) console.log(`  Research access verified; tier: ${connection.capabilities.tier}.`);
    if (venue === "polymarket" && query) {
      const tool = connection.tools.find((tool) => tool.name === "pt_markets_search");
      if (!tool || !tool.inputSchema?.properties?.query) throw new Error("Search schema unavailable");
      const result = await connection.call(tool.name, { query });
      if (result.isError) throw new Error("Search returned a tool error");
      console.log("  Polymarket market search succeeded (no model call).");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`${venue}: ${error instanceof McpError ? error.message : "MCP research check failed. Check configuration, network access and provider availability."}`);
  } finally { await connection?.close(); }
}
