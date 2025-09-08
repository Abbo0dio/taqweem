// Optimized Calendar App with Performance Improvements
class OptimizedCalendar {
  constructor() {
    this.currentDate = new Date();
    this.currentMonth = this.currentDate.getMonth();
    this.currentYear = this.currentDate.getFullYear();
    
    // Caching
    this.events = [];
    this.eventCache = new Map(); // Cache events by month-year
    this.config = null;
    
    // DOM element caching
    this.elements = {};
    
    // Event delegation
    this.calendarBody = null;
    
    // Debouncing/throttling
    this.renderTimeout = null;
    this.pendingUpdates = new Set();
    
    this.init();
  }

  async init() {
    // Cache DOM elements
    this.cacheElements();
    
    // Load config and events in parallel
    const [config, events] = await Promise.all([
      this.loadConfig(),
      this.loadEventsForMonth()
    ]);
    
    this.config = config;
    this.events = events;
    
    // Apply configuration
    this.applyTheme();
    this.populateEventTypes();
    
    // Use requestAnimationFrame for initial render
    requestAnimationFrame(() => {
      this.renderCalendar();
      this.renderEventList();
    });
    
    // Attach optimized event listeners
    this.attachEventListeners();
  }

  // Cache frequently accessed DOM elements
  cacheElements() {
    this.elements = {
      monthYear: document.getElementById('monthYear'),
      calendarHeader: document.getElementById('calendarHeader'),
      calendarBody: document.getElementById('calendarBody'),
      eventList: document.getElementById('eventList'),
      eventModal: document.getElementById('eventModal'),
      eventForm: document.getElementById('eventForm'),
      eventTypeSelect: document.getElementById('eventType')
    };
    
    this.calendarBody = this.elements.calendarBody;
  }

  // Load configuration with caching
  async loadConfig() {
    // Check if config is in sessionStorage
    const cached = sessionStorage.getItem('calendar-config');
    if (cached) {
      const { config, timestamp } = JSON.parse(cached);
      // Use cache if less than 1 hour old
      if (Date.now() - timestamp < 3600000) {
        return config;
      }
    }
    
    try {
      const response = await fetch('/api/config', {
        headers: {
          'Cache-Control': 'max-age=3600'
        }
      });
      const config = await response.json();
      
      // Cache in sessionStorage
      sessionStorage.setItem('calendar-config', JSON.stringify({
        config,
        timestamp: Date.now()
      }));
      
      return config;
    } catch (error) {
      console.error('Error loading config:', error);
      return this.getDefaultConfig();
    }
  }

  // Load events for current month only
  async loadEventsForMonth(month = this.currentMonth, year = this.currentYear) {
    const cacheKey = `${year}-${month}`;
    
    // Check cache first
    if (this.eventCache.has(cacheKey)) {
      return this.eventCache.get(cacheKey);
    }
    
    try {
      // Calculate month boundaries
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);
      
      // Fetch with month filter
      const response = await fetch(
        `/api/events?start=${startDate.toISOString().split('T')[0]}&end=${endDate.toISOString().split('T')[0]}`
      );
      const data = await response.json();
      
      if (data.success) {
        const events = data.events || [];
        // Cache the result
        this.eventCache.set(cacheKey, events);
        return events;
      }
      
      return [];
    } catch (error) {
      console.error('Error loading events:', error);
      // Try localStorage fallback
      const saved = localStorage.getItem('calendar-events-' + cacheKey);
      return saved ? JSON.parse(saved) : [];
    }
  }

  // Optimized calendar rendering with minimal DOM manipulation
  renderCalendar() {
    // Only update if necessary elements exist
    if (!this.elements.calendarBody) return;
    
    // Update month/year display
    this.elements.monthYear.textContent = 
      `${this.config.locale.monthNames[this.currentMonth]} ${this.currentYear}`;
    
    // Generate headers only once
    if (this.elements.calendarHeader.children.length === 0) {
      this.renderHeaders();
    }
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    const daysInMonth = this.getDaysInMonth(this.currentMonth, this.currentYear);
    const firstDay = this.getFirstDayOfMonth(this.currentMonth, this.currentYear);
    
    // Reuse date formatting
    const today = new Date();
    const isCurrentMonth = 
      this.currentMonth === today.getMonth() && 
      this.currentYear === today.getFullYear();
    const todayDate = today.getDate();
    
    let date = 1;
    
    // Create calendar grid efficiently
    for (let week = 0; week < 6; week++) {
      const row = document.createElement('tr');
      
      for (let day = 0; day < 7; day++) {
        const cell = document.createElement('td');
        
        if (week === 0 && day < firstDay) {
          // Previous month - skip for now
          cell.classList.add('other-month');
        } else if (date > daysInMonth) {
          // Next month - skip for now
          cell.classList.add('other-month');
        } else {
          // Current month day
          this.configureDayCell(cell, date, day, isCurrentMonth, todayDate);
          date++;
        }
        
        row.appendChild(cell);
      }
      
      fragment.appendChild(row);
      
      if (date > daysInMonth) break;
    }
    
    // Single DOM update
    this.calendarBody.innerHTML = '';
    this.calendarBody.appendChild(fragment);
  }

  // Configure individual day cell
  configureDayCell(cell, date, dayOfWeek, isCurrentMonth, todayDate) {
    const dateStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    
    cell.dataset.date = dateStr;
    cell.innerHTML = `<div class="calendar-date">${date}</div>`;
    
    // Highlight today
    if (isCurrentMonth && date === todayDate && this.config.calendar.highlightToday) {
      cell.classList.add('today');
    }
    
    // Mark weekends
    if (this.config.calendar.highlightWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
      cell.classList.add('weekend');
    }
    
    // Add events efficiently
    const dayEvents = this.getEventsForDate(dateStr);
    if (dayEvents.length > 0) {
      this.addEventIndicators(cell, dayEvents);
    }
  }

  // Get events for a specific date from cached events
  getEventsForDate(dateStr) {
    return this.events.filter(event => event.date === dateStr);
  }

  // Add event indicators to cell
  addEventIndicators(cell, events) {
    cell.classList.add('has-event');
    
    const maxToShow = Math.min(events.length, this.config.calendar.maxEventsPerDay - 1);
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < maxToShow; i++) {
      const indicator = this.createEventIndicator(events[i]);
      fragment.appendChild(indicator);
    }
    
    if (events.length > maxToShow) {
      const more = document.createElement('span');
      more.className = 'event-indicator';
      more.textContent = `+${events.length - maxToShow} more`;
      fragment.appendChild(more);
    }
    
    cell.appendChild(fragment);
  }

  // Create event indicator element
  createEventIndicator(event) {
    const indicator = document.createElement('span');
    indicator.className = 'event-indicator';
    
    const eventType = this.config.eventTypes.find(t => t.value === event.type);
    if (eventType) {
      indicator.style.backgroundColor = eventType.color;
      indicator.textContent = `${eventType.icon || ''} ${event.title}`.trim();
    } else {
      indicator.textContent = event.title;
    }
    
    indicator.title = event.title;
    return indicator;
  }

  // Render headers once
  renderHeaders() {
    const fragment = document.createDocumentFragment();
    
    this.config.locale.dayNames.forEach(day => {
      const th = document.createElement('th');
      th.textContent = day;
      fragment.appendChild(th);
    });
    
    this.elements.calendarHeader.appendChild(fragment);
  }

  // Optimized event listeners using delegation
  attachEventListeners() {
    // Single event listener for entire calendar body
    this.calendarBody.addEventListener('click', (e) => {
      const cell = e.target.closest('td');
      if (cell && cell.dataset.date) {
        this.handleDateClick(cell.dataset.date);
      }
    });
    
    // Navigation buttons
    document.getElementById('prevMonth').addEventListener('click', () => this.changeMonth(-1));
    document.getElementById('nextMonth').addEventListener('click', () => this.changeMonth(1));
    document.getElementById('todayBtn').addEventListener('click', () => this.goToToday());
    
    // Modal events
    document.getElementById('addEventBtn').addEventListener('click', () => this.showModal());
    document.querySelector('.close').addEventListener('click', () => this.hideModal());
    
    // Form submission
    this.elements.eventForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
    
    // Modal backdrop click
    this.elements.eventModal.addEventListener('click', (e) => {
      if (e.target === this.elements.eventModal) {
        this.hideModal();
      }
    });
  }

  // Optimized month navigation
  async changeMonth(direction) {
    this.currentMonth += direction;
    
    if (this.currentMonth < 0) {
      this.currentMonth = 11;
      this.currentYear--;
    } else if (this.currentMonth > 11) {
      this.currentMonth = 0;
      this.currentYear++;
    }
    
    // Load events for new month
    this.events = await this.loadEventsForMonth();
    
    // Use RAF for smooth transition
    requestAnimationFrame(() => {
      this.renderCalendar();
      this.renderEventList();
    });
  }

  // Optimistic UI updates
  async addEvent(eventData) {
    // Create optimistic event
    const optimisticEvent = {
      id: 'temp-' + Date.now(),
      ...eventData,
      createdAt: new Date().toISOString()
    };
    
    // Add to local state immediately
    this.events.push(optimisticEvent);
    
    // Update UI immediately
    this.updateCalendarCell(eventData.date);
    this.renderEventList();
    this.hideModal();
    
    try {
      // Send to server
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Replace optimistic event with real one
        const index = this.events.findIndex(e => e.id === optimisticEvent.id);
        if (index !== -1) {
          this.events[index] = data.event;
        }
        
        // Clear cache for this month
        const cacheKey = `${this.currentYear}-${this.currentMonth}`;
        this.eventCache.delete(cacheKey);
      } else {
        // Rollback on failure
        this.events = this.events.filter(e => e.id !== optimisticEvent.id);
        this.updateCalendarCell(eventData.date);
        alert('Failed to save event');
      }
    } catch (error) {
      console.error('Error saving event:', error);
      // Rollback
      this.events = this.events.filter(e => e.id !== optimisticEvent.id);
      this.updateCalendarCell(eventData.date);
    }
  }

  // Update single calendar cell instead of re-rendering entire calendar
  updateCalendarCell(dateStr) {
    const cell = this.calendarBody.querySelector(`td[data-date="${dateStr}"]`);
    if (!cell) return;
    
    // Remove existing indicators
    const indicators = cell.querySelectorAll('.event-indicator');
    indicators.forEach(i => i.remove());
    
    // Re-add event indicators
    const dayEvents = this.getEventsForDate(dateStr);
    if (dayEvents.length > 0) {
      this.addEventIndicators(cell, dayEvents);
    } else {
      cell.classList.remove('has-event');
    }
  }

  // Optimized event list rendering
  renderEventList() {
    if (!this.elements.eventList) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcomingEvents = this.events
      .filter(event => new Date(event.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, this.config.calendar.upcomingEventsLimit);
    
    if (upcomingEvents.length === 0) {
      this.elements.eventList.innerHTML = '<p style="color: var(--text-muted);">No upcoming events</p>';
      return;
    }
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    
    upcomingEvents.forEach(event => {
      const eventItem = this.createEventListItem(event);
      fragment.appendChild(eventItem);
    });
    
    this.elements.eventList.innerHTML = '';
    this.elements.eventList.appendChild(fragment);
  }

  // Create event list item
  createEventListItem(event) {
    const item = document.createElement('div');
    item.className = 'event-item';
    
    const eventType = this.config.eventTypes.find(t => t.value === event.type);
    const icon = eventType?.icon || '';
    
    item.innerHTML = `
      <div class="event-info">
        <div class="event-title">${icon} ${event.title}</div>
        <div class="event-date-time">${this.formatEventDate(event)}</div>
        ${event.description ? `<div class="event-description">${event.description}</div>` : ''}
      </div>
      <button class="delete-event" data-id="${event.id}">Delete</button>
    `;
    
    // Attach delete handler directly
    item.querySelector('.delete-event').addEventListener('click', () => {
      if (confirm('Delete this event?')) {
        this.deleteEvent(event.id);
      }
    });
    
    return item;
  }

  // Format event date for display
  formatEventDate(event) {
    const date = new Date(event.date);
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    return event.time ? `${dateStr} at ${event.time}` : dateStr;
  }

  // Helper methods
  getDaysInMonth(month, year) {
    return new Date(year, month + 1, 0).getDate();
  }

  getFirstDayOfMonth(month, year) {
    return new Date(year, month, 1).getDay();
  }

  goToToday() {
    const today = new Date();
    this.currentMonth = today.getMonth();
    this.currentYear = today.getFullYear();
    this.loadEventsForMonth().then(events => {
      this.events = events;
      requestAnimationFrame(() => {
        this.renderCalendar();
        this.renderEventList();
      });
    });
  }

  handleDateClick(date) {
    document.getElementById('eventDate').value = date;
    this.showModal();
  }

  showModal() {
    this.elements.eventModal.classList.add('show');
  }

  hideModal() {
    this.elements.eventModal.classList.remove('show');
    this.elements.eventForm.reset();
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    
    const eventData = {
      title: document.getElementById('eventTitle').value,
      date: document.getElementById('eventDate').value,
      time: document.getElementById('eventTime').value,
      type: document.getElementById('eventType').value,
      description: document.getElementById('eventDescription').value
    };
    
    await this.addEvent(eventData);
  }

  async deleteEvent(eventId) {
    // Optimistic deletion
    const event = this.events.find(e => e.id === eventId);
    this.events = this.events.filter(e => e.id !== eventId);
    
    // Update UI immediately
    if (event) {
      this.updateCalendarCell(event.date);
    }
    this.renderEventList();
    
    try {
      const response = await fetch(`/api/events/${eventId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (!data.success) {
        // Rollback on failure
        if (event) {
          this.events.push(event);
          this.updateCalendarCell(event.date);
          this.renderEventList();
        }
        alert('Failed to delete event');
      } else {
        // Clear cache
        const cacheKey = `${this.currentYear}-${this.currentMonth}`;
        this.eventCache.delete(cacheKey);
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      // Rollback
      if (event) {
        this.events.push(event);
        this.updateCalendarCell(event.date);
        this.renderEventList();
      }
    }
  }

  // Apply theme colors
  applyTheme() {
    const root = document.documentElement;
    const colors = this.config.theme.colors;
    
    Object.keys(colors).forEach(key => {
      const cssVarName = '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
      root.style.setProperty(cssVarName, colors[key]);
    });
  }

  // Populate event types dropdown
  populateEventTypes() {
    if (!this.elements.eventTypeSelect) return;
    
    const fragment = document.createDocumentFragment();
    
    this.config.eventTypes.forEach(type => {
      const option = document.createElement('option');
      option.value = type.value;
      option.textContent = type.label;
      fragment.appendChild(option);
    });
    
    this.elements.eventTypeSelect.innerHTML = '';
    this.elements.eventTypeSelect.appendChild(fragment);
  }

  // Get default config
  getDefaultConfig() {
    return {
      theme: { colors: {} },
      eventTypes: [
        { value: 'meeting', label: 'Meeting', color: '#458588', icon: '📅' },
        { value: 'personal', label: 'Personal', color: '#b16286', icon: '👤' }
      ],
      calendar: {
        maxEventsPerDay: 3,
        upcomingEventsLimit: 10,
        highlightToday: true,
        highlightWeekends: true
      },
      locale: {
        monthNames: [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ],
        dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      }
    };
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new OptimizedCalendar();
});
