import { startPolling } from "../../../../../lib/polling-service";

/**
 * Initialize the polling service
 * Call this endpoint once to start background polling
 * GET /api/polling/init
 */
export async function GET() {
  try {
    // Import and start the polling service
    // This ensures it's initialized in the Next.js server context
    startPolling();
    
    return Response.json({ 
      ok: true, 
      message: "Polling service initialized",
      note: "Service will start automatically if POLL_ENABLED=true"
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
