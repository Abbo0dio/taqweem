# Calendar API Documentation v2.0

## Base URL
```
http://localhost:3000
```

## Authentication
Most endpoints support optional API key authentication. Some administrative endpoints require it.

### Using API Keys
Include your API key in requests using either:
- Header: `X-API-Key: your-api-key`
- Query parameter: `?apiKey=your-api-key`

### Generate API Key
```http
POST /api/keys/generate
```

## Core Event Endpoints

### Get All Events
```http
GET /api/events
```

Query Parameters:
- `start` - Start date (YYYY-MM-DD)
- `end` - End date (YYYY-MM-DD)
- `month` - Month number (1-12)
- `year` - Year (YYYY)
- `type` - Event type filter
- `search` - Search query
- `limit` - Max results (default: 100)
- `offset` - Pagination offset (default: 0)

Response:
```json
{
  "success": true,
  "events": [...],
  "total": 50,
  "limit": 100,
  "offset": 0,
  "hasMore": false
}
```

### Get Today's Events
```http
GET /api/events/today
```

Response:
```json
{
  "success": true,
  "events": [...],
  "date": "2024-01-15"
}
```

### Get Upcoming Events
```http
GET /api/events/upcoming?days=7
```

Query Parameters:
- `days` - Number of days ahead (default: 7)

### Search Events
```http
GET /api/events/search?q=meeting
```

Query Parameters:
- `q` - Search query (required)

### Get Events by Type
```http
GET /api/events/type/:type
```

Example: `/api/events/type/meeting`

### Get Single Event
```http
GET /api/events/:id
```

### Get Events Needing Reminders
```http
GET /api/events/reminders?minutes=15
```

Query Parameters:
- `minutes` - Check window in minutes (default: 15)

### Create Event
```http
POST /api/events
```

Request Body:
```json
{
  "title": "Team Meeting",
  "date": "2024-01-20",
  "time": "14:00",
  "type": "meeting",
  "description": "Weekly sync",
  "location": "Conference Room A",
  "notifications": {
    "push": ["15m", "5m"],
    "email": ["1h"],
    "sms": ["30m"]
  }
}
```

### Update Event
```http
PUT /api/events/:id
```

Request Body: Any event fields to update

### Delete Event
```http
DELETE /api/events/:id
```

## Batch Operations

### Batch Requests
```http
POST /api/batch
```

Request Body:
```json
{
  "operations": [
    { "method": "GET", "url": "/api/events/today" },
    { "method": "GET", "url": "/api/events/upcoming", "params": { "days": 3 } },
    { "method": "POST", "url": "/api/events", "body": { ... } }
  ]
}
```

## Notification Endpoints

### Get Pending Notifications
```http
GET /api/notifications/pending?minutes=15
```

### Mark Notification as Sent
```http
POST /api/notifications/:eventId/sent
```

Request Body:
```json
{
  "method": "push",
  "status": "sent"
}
```

### Get Notification History
```http
GET /api/notifications/history?limit=100
```
**Requires API Key**

## Webhook Management

### List Webhooks
```http
GET /api/webhooks
```
**Requires API Key**

### Create Webhook
```http
POST /api/webhooks
```
**Requires API Key**

Request Body:
```json
{
  "url": "https://your-app.com/webhook",
  "events": ["event.created", "event.updated", "event.deleted", "event.reminder"],
  "secret": "optional-secret-for-signatures"
}
```

Available Events:
- `event.created` - New event created
- `event.updated` - Event updated
- `event.deleted` - Event deleted
- `event.reminder` - Event reminder due
- `*` - All events

### Delete Webhook
```http
DELETE /api/webhooks/:id
```
**Requires API Key**

## Real-time Updates

### WebSocket Connection
```
ws://localhost:3000/api/events/stream
```

Message Types:
- `connected` - Initial connection confirmation
- `event-added` - New event created
- `event-updated` - Event modified
- `event-deleted` - Event removed
- `reminders-due` - Reminders are due

Example Client:
```javascript
const ws = new WebSocket('ws://localhost:3000/api/events/stream');

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Event:', message.type, message.data);
});
```

## Export Formats

### iCal Export
```http
GET /api/calendar.ics
```

Returns calendar in iCalendar format for import into other calendar applications.

## Configuration

### Get Configuration
```http
GET /api/config
```

Returns theme, event types, and calendar settings.

## Health & Status

### Health Check
```http
GET /api/health
```

Response:
```json
{
  "success": true,
  "message": "Calendar API server is running",
  "version": "2.0.0",
  "stats": {
    "totalEvents": 42,
    "todayEvents": 3,
    "upcomingEvents": 12,
    "webhooks": 2,
    "wsClients": 5,
    "cacheAge": { ... },
    "memory": { ... }
  }
}
```

## Error Responses

All errors follow this format:
```json
{
  "success": false,
  "error": "Error message"
}
```

Common HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized (invalid API key)
- `404` - Not Found
- `500` - Server Error

## Rate Limiting

API requests are subject to rate limiting:
- Without API key: 100 requests/hour
- With API key: 1000 requests/hour

## Webhook Payload Format

Webhooks receive POST requests with this payload:
```json
{
  "event": "event.created",
  "data": { ... event data ... },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

If a secret is configured, the signature is sent in the `X-Calendar-Signature` header.

## Integration Examples

### Mobile App (React Native)
```javascript
// Fetch today's events
const response = await fetch('http://server:3000/api/events/today');
const { events } = await response.json();

// Listen for real-time updates
const ws = new WebSocket('ws://server:3000/api/events/stream');
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  // Update UI
};
```

### Notification Service
```javascript
// Check for reminders every minute
setInterval(async () => {
  const res = await fetch('http://server:3000/api/notifications/pending');
  const { notifications } = await res.json();
  
  notifications.forEach(event => {
    sendPushNotification(event);
    // Mark as sent
    fetch(`http://server:3000/api/notifications/${event.id}/sent`, {
      method: 'POST',
      body: JSON.stringify({ method: 'push' })
    });
  });
}, 60000);
```

### Calendar Sync
```bash
# Import to Google Calendar, Outlook, etc.
curl http://server:3000/api/calendar.ics > my-calendar.ics
```

## Testing

Run the included test script:
```bash
node test-api.js
```

## Security Notes

1. **API Keys**: Store securely, never commit to version control
2. **HTTPS**: Use HTTPS in production for encrypted communication
3. **CORS**: Configure CORS appropriately for your clients
4. **Webhooks**: Verify signatures when using webhook secrets
5. **Rate Limiting**: Implement additional rate limiting in production

## SDK Support

The API is designed to work with any HTTP client:
- JavaScript/Node.js: `fetch`, `axios`
- Python: `requests`
- Mobile: Native HTTP libraries
- CLI: `curl`, `httpie`

## Future Enhancements

Planned features for v3.0:
- GraphQL endpoint
- OAuth 2.0 authentication
- Recurring events
- Multi-user support
- Event attachments
- CalDAV protocol
- Push notification services (FCM, APNs)
