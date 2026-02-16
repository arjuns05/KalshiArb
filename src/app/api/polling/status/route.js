import { getStatus, poll } from "../../../../../lib/polling-service";

/**
 * GET /api/polling/status - Get current polling status
 */
export async function GET() {
  try {
    const status = getStatus();
    return Response.json({ ok: true, ...status });
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/polling/status - Trigger a manual poll
 */
export async function POST() {
  try {
    const result = await poll();
    return Response.json({ ok: true, result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
