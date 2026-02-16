import { subscribe, startPolling } from "../../../../../lib/polling-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Initialize polling service when this route is accessed
if (typeof window === "undefined") {
  startPolling();
}

/**
 * Server-Sent Events (SSE) endpoint for real-time polling updates
 * 
 * Usage:
 *   const eventSource = new EventSource('/api/polling/stream');
 *   eventSource.onmessage = (event) => {
 *     const data = JSON.parse(event.data);
 *     console.log('Poll update:', data);
 *   };
 */
export async function GET(request) {
  let unsubscribe = null;

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection message
      const send = (data) => {
        try {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (err) {
          console.error("Error sending SSE message:", err);
        }
      };

      send({ type: "connected", timestamp: new Date().toISOString() });

      // Subscribe to polling updates
      unsubscribe = subscribe((result) => {
        try {
          send({
            type: "poll_update",
            ...result
          });
        } catch (err) {
          console.error("Error sending SSE message:", err);
        }
      });
    },
    cancel() {
      // Cleanup when client disconnects
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }
  });

  // Handle request abort (client disconnect)
  request.signal?.addEventListener("abort", () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no" // Disable nginx buffering
    }
  });
}
