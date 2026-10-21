import { loadArbitrage } from "../../../../lib/arb.js";
import { saveScan } from "../../../../lib/db.js";

export const dynamic = "force-dynamic";

export async function GET() {
  let result;
  try {
    result = await loadArbitrage();
  } catch {
    return Response.json({ error: "Could not scan markets. Try again." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  try {
    await saveScan(result);
  } catch (error) {
    console.warn("could not save scan:", error.message);
  }

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
