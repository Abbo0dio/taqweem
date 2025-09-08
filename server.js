const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'calendar-data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const WEBHOOKS_FILE = path.join(__dirname, 'webhooks.json');
const NOTIFICATIONS_FILE = path.join(__dirname, 'notifications.json');

// In-memory cache and data management
class DataCache {
  constructor() {
    this.events = null;
    this.config = null;
    this.webhooks = [];
    this.notifications = [];
    this.apiKeys = new Map();
    this.lastModified = {
      events: null,
      config: null
    };
    this.writeTimer = null;
    this.eventsByDate = {};
    this.wsClients = new Set();
  }

  // Get events with caching
  async getEvents() {
    if (!this.events) {
      await this.loadEvents();
    }
    return this.events;
  }

  // Load events from file
  async loadEvents() {
    try {
      const data = await fs.readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse(data);
      this.events = parsed.events || [];
      this.lastModified.events = Date.now();
      
      // Index events by date
      this.eventsByDate = {};
      this.events.forEach(event => {
        if (!this.eventsByDate[event.date]) {
          this.eventsByDate[event.date] = [];
        }
        this.eventsByDate[event.date].push(event);
      });
      
      return this.events;
    } catch (error) {
      console.error('Error loading events:', error);
      this.events = [];
      return [];
    }
  }

  // Get today's events
  getTodayEvents() {
    const today = new Date().toISOString().split('T')[0];
    return this.eventsByDate[today] || [];
  }

  // Get upcoming events
  getUpcomingEvents(days = 7) {
    const result = [];
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + days);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (this.eventsByDate[dateStr]) {
        result.push(...this.eventsByDate[dateStr]);
      }
    }
    
    return result.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  // Search events
  searchEvents(query) {
    const lowerQuery = query.toLowerCase();
    return this.events.filter(event => 
      event.title.toLowerCase().includes(lowerQuery) ||
      (event.description && event.description.toLowerCase().includes(lowerQuery)) ||
      event.type.toLowerCase().includes(lowerQuery)
    );
  }

  // Get events by type
  getEventsByType(type) {
    return this.events.filter(event => event.type === type);
  }

  // Get events in date range
  getEventsInRange(startDate, endDate) {
    const result = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (this.eventsByDate[dateStr]) {
        result.push(...this.eventsByDate[dateStr]);
      }
    }
    
    return result;
  }

  // Get events needing reminders
  getEventsNeedingReminders(minutesBefore = 15) {
    const now = new Date();
    const checkTime = new Date(now.getTime() + minutesBefore * 60000);
    const result = [];
    
    this.events.forEach(event => {
      if (event.date && event.time) {
        const eventTime = new Date(`${event.date}T${event.time}`);
        if (eventTime > now && eventTime <= checkTime) {
          const minutesUntil = Math.floor((eventTime - now) / 60000);
          result.push({
            ...event,
            minutesUntil,
            notificationTime: now.toISOString()
          });
        }
      }
    });
    
    return result;
  }

  // Add event with notifications
  async addEvent(eventData) {
    const newEvent = {
      id: Date.now().toString(),
      ...eventData,
      createdAt: new Date().toISOString(),
      notifications: eventData.notifications || {
        push: ['15m'],
        email: ['1h'],
        sms: []
      }
    };
    
    this.events.push(newEvent);
    
    // Update index
    if (!this.eventsByDate[newEvent.date]) {
      this.eventsByDate[newEvent.date] = [];
    }
    this.eventsByDate[newEvent.date].push(newEvent);
    
    // Broadcast to WebSocket clients
    this.broadcast({
      type: 'event-added',
      data: newEvent
    });
    
    // Trigger webhooks
    this.triggerWebhooks('event.created', newEvent);
    
    this.queueWrite();
    return newEvent;
  }

  // Update event
  async updateEvent(eventId, updates) {
    const index = this.events.findIndex(e => e.id === eventId);
    if (index === -1) return null;
    
    const oldEvent = this.events[index];
    const updatedEvent = {
      ...oldEvent,
      ...updates,
      id: eventId,
      updatedAt: new Date().toISOString()
    };
    
    this.events[index] = updatedEvent;
    
    // Update index
    if (oldEvent.date !== updatedEvent.date) {
      // Remove from old date
      if (this.eventsByDate[oldEvent.date]) {
        this.eventsByDate[oldEvent.date] = this.eventsByDate[oldEvent.date]
          .filter(e => e.id !== eventId);
      }
      // Add to new date
      if (!this.eventsByDate[updatedEvent.date]) {
        this.eventsByDate[updatedEvent.date] = [];
      }
      this.eventsByDate[updatedEvent.date].push(updatedEvent);
    }
    
    // Broadcast update
    this.broadcast({
      type: 'event-updated',
      data: updatedEvent
    });
    
    this.triggerWebhooks('event.updated', updatedEvent);
    this.queueWrite();
    return updatedEvent;
  }

  // Delete event
  async deleteEvent(eventId) {
    const index = this.events.findIndex(e => e.id === eventId);
    if (index === -1) return false;
    
    const event = this.events[index];
    this.events.splice(index, 1);
    
    // Update index
    if (this.eventsByDate[event.date]) {
      this.eventsByDate[event.date] = this.eventsByDate[event.date]
        .filter(e => e.id !== eventId);
    }
    
    // Broadcast deletion
    this.broadcast({
      type: 'event-deleted',
      data: { id: eventId }
    });
    
    this.triggerWebhooks('event.deleted', { id: eventId });
    this.queueWrite();
    return true;
  }

  // WebSocket broadcast
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    this.wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  // Webhook management
  async loadWebhooks() {
    try {
      const data = await fs.readFile(WEBHOOKS_FILE, 'utf8');
      this.webhooks = JSON.parse(data);
    } catch {
      this.webhooks = [];
    }
  }

  async saveWebhooks() {
    await fs.writeFile(WEBHOOKS_FILE, JSON.stringify(this.webhooks, null, 2));
  }

  async addWebhook(webhook) {
    const newWebhook = {
      id: crypto.randomBytes(16).toString('hex'),
      ...webhook,
      createdAt: new Date().toISOString()
    };
    this.webhooks.push(newWebhook);
    await this.saveWebhooks();
    return newWebhook;
  }

  async removeWebhook(id) {
    this.webhooks = this.webhooks.filter(w => w.id !== id);
    await this.saveWebhooks();
  }

  // Trigger webhooks for an event
  async triggerWebhooks(eventType, data) {
    const relevantWebhooks = this.webhooks.filter(w => 
      w.events.includes(eventType) || w.events.includes('*')
    );
    
    relevantWebhooks.forEach(webhook => {
      // In production, use a queue system
      this.callWebhook(webhook, eventType, data);
    });
  }

  async callWebhook(webhook, eventType, data) {
    try {
      const payload = {
        event: eventType,
        data,
        timestamp: new Date().toISOString()
      };
      
      // Calculate signature if secret provided
      let headers = { 'Content-Type': 'application/json' };
      if (webhook.secret) {
        const signature = crypto
          .createHmac('sha256', webhook.secret)
          .update(JSON.stringify(payload))
          .digest('hex');
        headers['X-Calendar-Signature'] = signature;
      }
      
      // In production, use fetch or axios
      console.log(`Webhook called: ${webhook.url}`, payload);
    } catch (error) {
      console.error('Webhook error:', error);
    }
  }

  // Notification tracking
  async loadNotifications() {
    try {
      const data = await fs.readFile(NOTIFICATIONS_FILE, 'utf8');
      this.notifications = JSON.parse(data);
    } catch {
      this.notifications = [];
    }
  }

  async addNotification(notification) {
    const newNotification = {
      id: Date.now().toString(),
      ...notification,
      sentAt: new Date().toISOString()
    };
    this.notifications.push(newNotification);
    
    // Keep only last 1000 notifications
    if (this.notifications.length > 1000) {
      this.notifications = this.notifications.slice(-1000);
    }
    
    await this.saveNotifications();
    return newNotification;
  }

  async saveNotifications() {
    await fs.writeFile(NOTIFICATIONS_FILE, JSON.stringify(this.notifications, null, 2));
  }

  // Generate iCal format
  generateICal() {
    let ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Calendar App//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    
    this.events.forEach(event => {
      const eventDate = event.date.replace(/-/g, '');
      const eventTime = event.time ? event.time.replace(/:/g, '') + '00' : '000000';
      
      ical.push('BEGIN:VEVENT');
      ical.push(`UID:${event.id}@calendar.app`);
      ical.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
      ical.push(`DTSTART:${eventDate}T${eventTime}`);
      ical.push(`SUMMARY:${event.title}`);
      if (event.description) {
        ical.push(`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`);
      }
      if (event.location) {
        ical.push(`LOCATION:${event.location}`);
      }
      ical.push('END:VEVENT');
    });
    
    ical.push('END:VCALENDAR');
    return ical.join('\r\n');
  }

  // API key management
  generateApiKey() {
    const key = crypto.randomBytes(32).toString('hex');
    const keyData = {
      key,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      requests: 0
    };
    this.apiKeys.set(key, keyData);
    return key;
  }

  validateApiKey(key) {
    if (!this.apiKeys.has(key)) return false;
    const keyData = this.apiKeys.get(key);
    keyData.lastUsed = new Date().toISOString();
    keyData.requests++;
    return true;
  }

  // Utility methods
  queueWrite() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    this.writeTimer = setTimeout(() => {
      this.writeEvents();
    }, 1000);
  }

  async writeEvents() {
    try {
      await fs.writeFile(DATA_FILE, JSON.stringify({ 
        events: this.events,
        lastModified: new Date().toISOString()
      }, null, 2));
      this.lastModified.events = Date.now();
      return true;
    } catch (error) {
      console.error('Error writing events:', error);
      return false;
    }
  }

  async getConfig() {
    if (!this.config) {
      await this.loadConfig();
    }
    return this.config;
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf8');
      this.config = JSON.parse(data);
      this.lastModified.config = Date.now();
      return this.config;
    } catch (error) {
      console.error('Error loading config:', error);
      return null;
    }
  }
}

// Initialize cache
const cache = new DataCache();

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json());

// API key validation middleware
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey && cache.validateApiKey(apiKey)) {
    next();
  } else {
    res.status(401).json({ error: 'Invalid or missing API key' });
  }
};

// Optional API key middleware (allows both authenticated and public access)
const optionalApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey) {
    cache.validateApiKey(apiKey);
  }
  next();
};

// Static files
app.use(express.static(__dirname, {
  maxAge: '1d',
  etag: true
}));

// Initialize data files
async function initDataFiles() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ 
      events: [],
      lastModified: new Date().toISOString()
    }, null, 2));
  }
  
  try {
    await fs.access(WEBHOOKS_FILE);
  } catch {
    await fs.writeFile(WEBHOOKS_FILE, '[]');
  }
  
  try {
    await fs.access(NOTIFICATIONS_FILE);
  } catch {
    await fs.writeFile(NOTIFICATIONS_FILE, '[]');
  }
}

// ============= API ENDPOINTS =============

// Health check with detailed stats
app.get('/api/health', async (req, res) => {
  const events = await cache.getEvents();
  
  res.json({ 
    success: true, 
    message: 'Calendar API server is running',
    version: '2.0.0',
    stats: {
      totalEvents: events.length,
      todayEvents: cache.getTodayEvents().length,
      upcomingEvents: cache.getUpcomingEvents(7).length,
      webhooks: cache.webhooks.length,
      wsClients: cache.wsClients.size,
      cacheAge: {
        events: cache.lastModified.events ? 
          Date.now() - cache.lastModified.events : null,
        config: cache.lastModified.config ? 
          Date.now() - cache.lastModified.config : null
      },
      memory: process.memoryUsage()
    }
  });
});

// Get all events (with optional filters)
app.get('/api/events', optionalApiKey, async (req, res) => {
  try {
    const { start, end, month, year, type, search, limit = 100, offset = 0 } = req.query;
    let events = await cache.getEvents();
    
    // Apply filters
    if (start && end) {
      events = cache.getEventsInRange(start, end);
    } else if (month && year) {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];
      events = cache.getEventsInRange(startDate, endDate);
    }
    
    if (type) {
      events = events.filter(e => e.type === type);
    }
    
    if (search) {
      events = cache.searchEvents(search);
    }
    
    // Pagination
    const total = events.length;
    events = events.slice(Number(offset), Number(offset) + Number(limit));
    
    res.json({ 
      success: true, 
      events,
      total,
      limit: Number(limit),
      offset: Number(offset),
      hasMore: total > Number(offset) + Number(limit)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get today's events
app.get('/api/events/today', optionalApiKey, async (req, res) => {
  try {
    await cache.getEvents();
    const events = cache.getTodayEvents();
    
    res.json({ 
      success: true, 
      events,
      date: new Date().toISOString().split('T')[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get upcoming events
app.get('/api/events/upcoming', optionalApiKey, async (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    await cache.getEvents();
    const events = cache.getUpcomingEvents(days);
    
    res.json({ 
      success: true, 
      events,
      days,
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + days * 86400000).toISOString().split('T')[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search events
app.get('/api/events/search', optionalApiKey, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, error: 'Query parameter required' });
    }
    
    await cache.getEvents();
    const events = cache.searchEvents(q);
    
    res.json({ 
      success: true, 
      events,
      query: q,
      count: events.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get events by type
app.get('/api/events/type/:type', optionalApiKey, async (req, res) => {
  try {
    await cache.getEvents();
    const events = cache.getEventsByType(req.params.type);
    
    res.json({ 
      success: true, 
      events,
      type: req.params.type,
      count: events.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single event
app.get('/api/events/:id', optionalApiKey, async (req, res) => {
  try {
    const events = await cache.getEvents();
    const event = events.find(e => e.id === req.params.id);
    
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    
    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get events needing reminders
app.get('/api/events/reminders', optionalApiKey, async (req, res) => {
  try {
    const minutes = Number(req.query.minutes) || 15;
    await cache.getEvents();
    const events = cache.getEventsNeedingReminders(minutes);
    
    res.json({ 
      success: true, 
      events,
      checkingNext: `${minutes} minutes`,
      currentTime: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create event
app.post('/api/events', optionalApiKey, async (req, res) => {
  try {
    const newEvent = await cache.addEvent(req.body);
    
    res.status(201).json({ 
      success: true, 
      event: newEvent,
      message: 'Event created successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update event
app.put('/api/events/:id', optionalApiKey, async (req, res) => {
  try {
    const updatedEvent = await cache.updateEvent(req.params.id, req.body);
    
    if (!updatedEvent) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    
    res.json({ 
      success: true, 
      event: updatedEvent,
      message: 'Event updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete event
app.delete('/api/events/:id', optionalApiKey, async (req, res) => {
  try {
    const success = await cache.deleteEvent(req.params.id);
    
    if (!success) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    
    res.json({ 
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch operations
app.post('/api/batch', optionalApiKey, async (req, res) => {
  try {
    const { operations } = req.body;
    if (!Array.isArray(operations)) {
      return res.status(400).json({ success: false, error: 'Operations must be an array' });
    }
    
    const results = [];
    for (const op of operations) {
      try {
        let result;
        switch (op.method) {
          case 'GET':
            if (op.url === '/api/events/today') {
              result = cache.getTodayEvents();
            } else if (op.url === '/api/events/upcoming') {
              result = cache.getUpcomingEvents(op.params?.days || 7);
            }
            break;
          case 'POST':
            if (op.url === '/api/events') {
              result = await cache.addEvent(op.body);
            }
            break;
          case 'DELETE':
            if (op.url.startsWith('/api/events/')) {
              const id = op.url.split('/').pop();
              result = await cache.deleteEvent(id);
            }
            break;
        }
        results.push({ success: true, data: result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// iCal export
app.get('/api/calendar.ics', async (req, res) => {
  try {
    await cache.getEvents();
    const ical = cache.generateICal();
    
    res.set({
      'Content-Type': 'text/calendar',
      'Content-Disposition': 'attachment; filename="calendar.ics"'
    });
    res.send(ical);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook management
app.get('/api/webhooks', requireApiKey, async (req, res) => {
  res.json({ 
    success: true, 
    webhooks: cache.webhooks.map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      createdAt: w.createdAt
    }))
  });
});

app.post('/api/webhooks', requireApiKey, async (req, res) => {
  try {
    const { url, events, secret } = req.body;
    
    if (!url || !events) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL and events array required' 
      });
    }
    
    const webhook = await cache.addWebhook({ url, events, secret });
    
    res.status(201).json({ 
      success: true, 
      webhook: {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/webhooks/:id', requireApiKey, async (req, res) => {
  try {
    await cache.removeWebhook(req.params.id);
    res.json({ success: true, message: 'Webhook removed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Notification endpoints
app.get('/api/notifications/pending', optionalApiKey, async (req, res) => {
  try {
    const minutes = Number(req.query.minutes) || 15;
    await cache.getEvents();
    const pending = cache.getEventsNeedingReminders(minutes);
    
    res.json({ 
      success: true, 
      notifications: pending,
      checkWindow: `${minutes} minutes`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notifications/:eventId/sent', optionalApiKey, async (req, res) => {
  try {
    const { method, status } = req.body;
    
    const notification = await cache.addNotification({
      eventId: req.params.eventId,
      method: method || 'unknown',
      status: status || 'sent'
    });
    
    res.json({ 
      success: true, 
      notification,
      message: 'Notification recorded'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/notifications/history', requireApiKey, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const notifications = cache.notifications.slice(-limit);
    
    res.json({ 
      success: true, 
      notifications,
      total: cache.notifications.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API key management
app.post('/api/keys/generate', async (req, res) => {
  try {
    const apiKey = cache.generateApiKey();
    
    res.status(201).json({ 
      success: true, 
      apiKey,
      message: 'Save this key securely - it cannot be retrieved later'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configuration endpoint
app.get('/api/config', async (req, res) => {
  try {
    const config = await cache.getConfig();
    
    if (!config) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to load configuration' 
      });
    }
    
    res.set({
      'Cache-Control': 'public, max-age=3600',
      'ETag': `"${cache.lastModified.config}"`
    });
    
    res.json(config);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve the calendar HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'calendar.html'));
});

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server, path: '/api/events/stream' });

wss.on('connection', (ws) => {
  cache.wsClients.add(ws);
  
  // Send initial connection message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to calendar event stream',
    timestamp: new Date().toISOString()
  }));
  
  // Handle ping/pong for connection health
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  
  ws.on('close', () => {
    cache.wsClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    cache.wsClients.delete(ws);
  });
});

// WebSocket health check
const wsHealthCheck = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      cache.wsClients.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Notification checker (runs every minute)
const notificationChecker = setInterval(async () => {
  try {
    await cache.getEvents();
    const pending = cache.getEventsNeedingReminders(15);
    
    if (pending.length > 0) {
      // Broadcast to WebSocket clients
      cache.broadcast({
        type: 'reminders-due',
        data: pending
      });
      
      // Trigger webhooks
      pending.forEach(event => {
        cache.triggerWebhooks('event.reminder', event);
      });
    }
  } catch (error) {
    console.error('Notification check error:', error);
  }
}, 60000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  clearInterval(notificationChecker);
  clearInterval(wsHealthCheck);
  
  wss.clients.forEach((ws) => {
    ws.close();
  });
  
  await cache.writeEvents();
  await cache.saveWebhooks();
  await cache.saveNotifications();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
async function startServer() {
  await initDataFiles();
  await cache.loadEvents();
  await cache.loadConfig();
  await cache.loadWebhooks();
  await cache.loadNotifications();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Calendar API Server v2.0`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://YOUR_SERVER_IP:${PORT}`);
    console.log(`📁 Data: ${DATA_FILE}`);
    console.log(`\n⚡ Features:`);
    console.log(`  • RESTful API with advanced endpoints`);
    console.log(`  • WebSocket real-time updates`);
    console.log(`  • Webhook support for integrations`);
    console.log(`  • Notification system with reminders`);
    console.log(`  • iCal export for standard calendar apps`);
    console.log(`  • API key authentication`);
    console.log(`  • Batch operations support`);
    console.log(`\n📚 API Docs: http://localhost:${PORT}/api/health\n`);
  });
}

startServer().catch(console.error);
