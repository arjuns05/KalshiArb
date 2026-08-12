import { NextResponse } from "next/server";
import { loadArbitrage } from "../../../../lib/arb";
import { saveScan } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadArbitrage();

  try {
    await saveScan(result);
  } catch (error) {
    console.warn("could not save scan:", error.message);
  }

  return NextResponse.json(result);
}
