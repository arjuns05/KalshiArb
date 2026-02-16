import { ingestNormalizedMarkets } from "./ingest.js";
import { fetchKalshiMarkets } from "./connectors/kalshi.js";
import { fetchPolymarketMarkets } from "./connectors/polymarket.js";

/**
 * Background polling service for live API updates
 * 
 * Configuration via environment variables:
 * - POLL_INTERVAL_MS: Milliseconds between polls (default: 60000 = 1 minute)
 * - POLL_ENABLED: Set to 'true' to enable automatic polling (default: false)
 * - POLL_ON_STARTUP: Set to 'true' to poll immediately on startup (default: true)
 */

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);
const POLL_ENABLED = process.env.POLL_ENABLED === "true";
const POLL_ON_STARTUP = process.env.POLL_ON_STARTUP !== "false";

let pollInterval = null;
let isPolling = false;
let lastPollTime = null;
let lastPollResult = null;
let subscribers = new Set();

/**
 * Subscribe to polling updates
 * @param {Function} callback - Called with { timestamp, result, error }
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
  subscribers.add(callback);
  // Immediately send last result if available
  if (lastPollResult) {
    callback(lastPollResult);
  }
  return () => subscribers.delete(callback);
}

/**
 * Notify all subscribers of a polling result
 */
function notifySubscribers(result) {
  subscribers.forEach(callback => {
    try {
      callback(result);
    } catch (err) {
      console.error("Error notifying subscriber:", err);
    }
  });
}

/**
 * Perform a single poll cycle
 */
export async function poll() {
  if (isPolling) {
    console.log("[Polling] Already polling, skipping...");
    return;
  }

  isPolling = true;
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    console.log("[Polling] Starting poll cycle...");
    
    // Fetch from all sources in parallel
    const [kalshi, poly] = await Promise.allSettled([
      fetchKalshiMarkets(),
      fetchPolymarketMarkets()
    ]);

    // Extract successful results
    const all = [
      ...(kalshi.status === "fulfilled" ? (kalshi.value || []) : []),
      ...(poly.status === "fulfilled" ? (poly.value || []) : [])
    ];

    // Log any failures
    if (kalshi.status === "rejected") {
      console.error("[Polling] Kalshi fetch failed:", kalshi.reason);
    }
    if (poly.status === "rejected") {
      console.error("[Polling] Polymarket fetch failed:", poly.reason);
    }

    // Ingest the markets
    const summary = await ingestNormalizedMarkets(all);

    const duration = Date.now() - startTime;
    lastPollTime = timestamp;
    lastPollResult = {
      timestamp,
      duration,
      fetched: all.length,
      summary,
      errors: {
        kalshi: kalshi.status === "rejected" ? kalshi.reason?.message : null,
        polymarket: poly.status === "rejected" ? poly.reason?.message : null
      }
    };

    console.log(`[Polling] Completed in ${duration}ms:`, summary);
    notifySubscribers(lastPollResult);

    return lastPollResult;
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorResult = {
      timestamp,
      duration,
      error: err?.message || "Unknown polling error",
      fetched: 0,
      summary: null
    };

    console.error("[Polling] Error:", err);
    lastPollResult = errorResult;
    notifySubscribers(errorResult);
    throw err;
  } finally {
    isPolling = false;
  }
}

/**
 * Start the polling service
 */
export function startPolling() {
  if (pollInterval) {
    console.log("[Polling] Already started");
    return;
  }

  if (!POLL_ENABLED) {
    console.log("[Polling] Polling disabled (set POLL_ENABLED=true to enable)");
    return;
  }

  console.log(`[Polling] Starting service with interval ${POLL_INTERVAL_MS}ms`);

  // Poll immediately on startup if enabled
  if (POLL_ON_STARTUP) {
    poll().catch(err => {
      console.error("[Polling] Initial poll failed:", err);
    });
  }

  // Set up interval
  pollInterval = setInterval(() => {
    poll().catch(err => {
      console.error("[Polling] Poll cycle failed:", err);
    });
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the polling service
 */
export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[Polling] Stopped");
  }
}

/**
 * Get the current polling status
 */
export function getStatus() {
  return {
    enabled: POLL_ENABLED,
    interval: POLL_INTERVAL_MS,
    isPolling,
    lastPollTime,
    subscribers: subscribers.size
  };
}

// Note: Auto-start is handled by importing this module in a Next.js API route
// or by calling startPolling() explicitly. We don't auto-start here to avoid
// issues with Next.js serverless functions and Edge runtime.
