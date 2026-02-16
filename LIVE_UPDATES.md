# Live API Updates

This project now includes a live polling system that automatically fetches updates from Kalshi, OddsAPI, and Polymarket APIs.

## Features

- **Background Polling**: Automatically fetches market data at configurable intervals
- **Real-time Updates**: Frontend receives live updates via Server-Sent Events (SSE)
- **Error Handling**: Gracefully handles API failures and continues polling
- **Manual Triggers**: Can trigger polls manually via API or UI

## Configuration

Set the following environment variables (create a `.env.local` file):

```bash
# Enable automatic background polling
POLL_ENABLED=true

# Polling interval in milliseconds (default: 60000 = 1 minute)
POLL_INTERVAL_MS=60000

# Poll immediately on service startup (default: true)
POLL_ON_STARTUP=true
```

## API Endpoints

### GET `/api/polling/status`
Get the current polling service status.

Response:
```json
{
  "ok": true,
  "enabled": true,
  "interval": 60000,
  "isPolling": false,
  "lastPollTime": "2024-01-01T12:00:00.000Z",
  "subscribers": 1
}
```

### POST `/api/polling/status`
Trigger a manual poll immediately.

Response:
```json
{
  "ok": true,
  "result": {
    "timestamp": "2024-01-01T12:00:00.000Z",
    "duration": 1234,
    "fetched": 10,
    "summary": {
      "touchedMarkets": 5,
      "touchedCanonicals": 3,
      "createdQuotes": 10
    }
  }
}
```

### GET `/api/polling/stream`
Server-Sent Events (SSE) endpoint for real-time updates.

Usage in JavaScript:
```javascript
const eventSource = new EventSource('/api/polling/stream');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Poll update:', data);
};
```

### GET `/api/polling/init`
Initialize the polling service (call once to start).

## Frontend Integration

The frontend automatically:
- Connects to the SSE stream on page load
- Displays polling status and last update time
- Refreshes market data when new quotes arrive
- Shows real-time indicators for active polling

## Architecture

1. **Polling Service** (`lib/polling-service.js`):
   - Manages background polling intervals
   - Fetches from all API connectors in parallel
   - Handles errors gracefully
   - Notifies subscribers of updates

2. **SSE Endpoint** (`src/app/api/polling/stream/route.js`):
   - Provides real-time updates to frontend
   - Uses Server-Sent Events for one-way communication
   - Handles client disconnections

3. **Frontend** (`src/app/page.js`):
   - Subscribes to SSE stream
   - Auto-refreshes when new data arrives
   - Shows polling status and controls

## Extending to Real APIs

To connect to real APIs, update the connector files:

- `lib/connectors/kalshi.js` - Add Kalshi API calls
- `lib/connectors/oddsapi.js` - Add OddsAPI calls  
- `lib/connectors/polymarket.js` - Add Polymarket API calls

Each connector should return an array of normalized market objects:
```javascript
{
  source: "kalshi" | "oddsapi" | "polymarket",
  bookName: string,
  externalId: string,
  eventName: string,
  startTime: Date | null,
  marketName: string,
  marketType: "two_way",
  outcomes: [
    { name: "YES", decimalOdds: number },
    { name: "NO", decimalOdds: number }
  ]
}
```

## Error Handling

The polling service:
- Uses `Promise.allSettled()` to continue even if one API fails
- Logs errors for each failed API
- Continues polling on errors
- Reports errors in poll results

## Performance Considerations

- Polling runs in the background and doesn't block requests
- Multiple clients can subscribe to the same SSE stream
- Database writes are batched through the ingest system
- Consider rate limits when setting `POLL_INTERVAL_MS`
