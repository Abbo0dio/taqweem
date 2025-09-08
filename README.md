# Taqweem

A self-hosted calendar server with REST API, WebSocket support, and customizable themes.

## Quick Start

### Installation
```bash
npm install
```

### Running the Server
```bash
npm start
```

The server runs on port 3000 by default. Access the calendar at:
- Local: http://localhost:3000
- Network: http://YOUR_SERVER_IP:3000

### Testing the API
```bash
node test-api.js
```

## Features

- Monthly calendar view with event management
- REST API with 25+ endpoints
- WebSocket real-time updates
- Webhook support for external integrations
- Notification system with reminders
- iCal export format
- Customizable themes and event types
- File-based storage
- API key authentication
- Batch operations

## Configuration

All customization is done through `config.json`:

### Theme Colors
Edit the `theme.colors` section to change the appearance:
```json
{
  "theme": {
    "colors": {
      "background": "#282828",
      "primary": "#fabd2f",
      "success": "#98971a"
    }
  }
}
```

See `config-themes-examples.json` for pre-made themes including Gruvbox, Dracula, Nord, Solarized, Tokyo Night, and Catppuccin.

### Event Types
Customize event categories in `config.json`:
```json
{
  "eventTypes": [
    {
      "value": "meeting",
      "label": "Meeting",
      "color": "#458588",
      "icon": "📅"
    }
  ]
}
```

Example configurations for professional, academic, personal, and medical event types are available in `config-themes-examples.json`.

### Calendar Settings
```json
{
  "calendar": {
    "highlightToday": true,
    "highlightWeekends": true,
    "maxEventsPerDay": 3,
    "upcomingEventsLimit": 10
  }
}
```

## API Documentation

### Event Endpoints

#### Core Operations
- `GET /api/events` - Get all events with optional filters
- `GET /api/events/today` - Today's events
- `GET /api/events/upcoming?days=7` - Upcoming events
- `GET /api/events/search?q=text` - Search events
- `GET /api/events/type/:type` - Events by type
- `GET /api/events/:id` - Single event details
- `POST /api/events` - Create new event
- `PUT /api/events/:id` - Update event
- `DELETE /api/events/:id` - Delete event

#### Notifications
- `GET /api/events/reminders?minutes=15` - Events needing reminders
- `GET /api/notifications/pending` - Pending notifications
- `POST /api/notifications/:id/sent` - Mark notification as sent
- `GET /api/notifications/history` - Notification history (requires API key)

#### Integration
- `WS /api/events/stream` - WebSocket connection for real-time updates
- `POST /api/webhooks` - Create webhook subscription (requires API key)
- `DELETE /api/webhooks/:id` - Remove webhook (requires API key)
- `GET /api/calendar.ics` - Export in iCal format
- `POST /api/batch` - Execute multiple operations in one request

#### System
- `GET /api/health` - Server health and statistics
- `GET /api/config` - Get current configuration
- `POST /api/keys/generate` - Generate API key

For complete API documentation with examples and integration guides, see [API.md](API.md).

## Integration Examples

### Mobile Application
```javascript
// Fetch today's events
const response = await fetch('http://server:3000/api/events/today');
const { events } = await response.json();

// Real-time updates
const ws = new WebSocket('ws://server:3000/api/events/stream');
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  // Handle event updates
};
```

### Notification Service
```javascript
// Check for reminders every minute
setInterval(async () => {
  const res = await fetch('/api/notifications/pending');
  const { notifications } = await res.json();
  
  notifications.forEach(event => {
    sendPushNotification(event);
    fetch(`/api/notifications/${event.id}/sent`, {
      method: 'POST',
      body: JSON.stringify({ method: 'push' })
    });
  });
}, 60000);
```

### Webhook Subscription
```bash
curl -X POST http://server:3000/api/webhooks \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.com/webhook", "events": ["event.created"]}'
```

### Calendar Export
```bash
# Export for import into Google Calendar, Outlook, etc.
curl http://server:3000/api/calendar.ics > calendar.ics
```

## System Service Installation

To run Taqweem as a system service on Linux:

### Install Service
```bash
sudo cp calendar.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### Enable Auto-start
```bash
sudo systemctl enable calendar.service
```

### Start Service
```bash
sudo systemctl start calendar.service
```

### Check Status
```bash
sudo systemctl status calendar.service
```

### View Logs
```bash
sudo journalctl -u calendar.service -f
```

## Data Storage

Events are stored in `calendar-data.json` on the server. The file is automatically created on first run.

### Backup
```bash
cp calendar-data.json calendar-backup-$(date +%Y%m%d).json
```

### Restore
```bash
cp calendar-backup-20240101.json calendar-data.json
sudo systemctl restart calendar.service
```

### Automated Backup
Add to crontab (`crontab -e`):
```bash
0 2 * * * cp /home/taqis/Pone/Schedule/calendar-data.json /backup/calendar-$(date +\%Y\%m\%d).json
```

## Network Access

### Port Forwarding
Forward port 3000 on your router to access from the internet.

### Reverse Proxy with Nginx
```nginx
server {
    listen 80;
    server_name calendar.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### HTTPS with Let's Encrypt
```bash
sudo certbot --nginx -d calendar.yourdomain.com
```

## Customization

### Change Port
Set environment variable:
```bash
PORT=8080 npm start
```

Or modify the PORT constant in `server.js`.

### Change Data File Location
Edit the DATA_FILE path in `server.js`.

## Troubleshooting

### Server won't start
- Check if port 3000 is in use: `sudo lsof -i :3000`
- Verify Node.js installation: `node --version` (requires v14+)
- Install dependencies: `npm install`

### Cannot access from other devices
- Check firewall: `sudo ufw status`
- Verify server IP: `ip addr show`
- Ensure server binds to 0.0.0.0 (default configuration)

### Events not saving
- Check file permissions: `ls -la calendar-data.json`
- View server logs: `sudo journalctl -u calendar.service -n 50`

### WebSocket connection fails
- Ensure firewall allows WebSocket connections
- Check if reverse proxy is configured for WebSocket upgrade

## Performance

The server includes several optimizations:
- In-memory caching for fast responses
- Event indexing by date for quick lookups
- Gzip compression for reduced bandwidth
- Debounced file writes to minimize disk I/O
- Optimistic UI updates in the web interface

## Security Considerations

- Use HTTPS in production environments
- Store API keys securely
- Configure CORS for your specific clients
- Implement rate limiting for public deployments
- Verify webhook signatures when using secrets
- Run the service as a non-root user

## Dependencies

- Express.js - Web framework
- WebSocket (ws) - Real-time communication
- Compression - Gzip middleware
- CORS - Cross-origin resource sharing

## License

MIT
