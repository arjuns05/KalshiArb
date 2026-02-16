export const dynamic = "force-dynamic";

/**
 * Initialize the polling service
 * Call this endpoint once to start background polling
 * GET /api/polling/init
 */
export async function GET() {
  return Response.json({
    ok: true,
    message: "Background polling is disabled. Use manual poll endpoints instead."
  });
}
