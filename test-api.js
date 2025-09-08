#!/usr/bin/env node

// Simple API test script
const http = require('http');

const API_BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

// Test helper
async function testEndpoint(name, path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && result.success !== false) {
            console.log(`✅ ${name}: OK (${res.statusCode})`);
            passed++;
          } else {
            console.log(`❌ ${name}: Failed (${res.statusCode})`);
            failed++;
          }
          resolve(result);
        } catch (e) {
          console.log(`❌ ${name}: Invalid JSON response`);
          failed++;
          resolve(null);
        }
      });
    });

    req.on('error', (error) => {
      console.log(`❌ ${name}: ${error.message}`);
      console.log(`   Make sure the server is running: npm start`);
      failed++;
      resolve(null);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n🧪 Testing Calendar API Endpoints\n');
  console.log('=' .repeat(50));

  // Test health endpoint
  await testEndpoint('Health Check', '/api/health');

  // Test event endpoints
  await testEndpoint('Get All Events', '/api/events');
  await testEndpoint('Get Today Events', '/api/events/today');
  await testEndpoint('Get Upcoming Events', '/api/events/upcoming?days=7');
  await testEndpoint('Search Events', '/api/events/search?q=test');
  await testEndpoint('Get Reminders', '/api/events/reminders?minutes=60');

  // Test event creation
  const testEvent = {
    title: 'API Test Event',
    date: new Date().toISOString().split('T')[0],
    time: '14:00',
    type: 'meeting',
    description: 'Test event created by API test'
  };
  
  const createResult = await testEndpoint('Create Event', '/api/events', 'POST', testEvent);
  
  if (createResult && createResult.event) {
    const eventId = createResult.event.id;
    
    // Test single event fetch
    await testEndpoint('Get Single Event', `/api/events/${eventId}`);
    
    // Test event update
    await testEndpoint('Update Event', `/api/events/${eventId}`, 'PUT', {
      title: 'Updated Test Event'
    });
    
    // Test event deletion
    await testEndpoint('Delete Event', `/api/events/${eventId}`, 'DELETE');
  }

  // Test batch operations
  await testEndpoint('Batch Operations', '/api/batch', 'POST', {
    operations: [
      { method: 'GET', url: '/api/events/today' },
      { method: 'GET', url: '/api/events/upcoming' }
    ]
  });

  // Test iCal export
  await testEndpoint('iCal Export', '/api/calendar.ics');

  // Test notification endpoints
  await testEndpoint('Pending Notifications', '/api/notifications/pending');

  // Test config
  await testEndpoint('Get Configuration', '/api/config');

  // Test API key generation
  const keyResult = await testEndpoint('Generate API Key', '/api/keys/generate', 'POST');
  if (keyResult && keyResult.apiKey) {
    console.log(`   Generated API Key: ${keyResult.apiKey.substring(0, 10)}...`);
  }

  console.log('\n' + '=' .repeat(50));
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed!\n');
  } else {
    console.log('⚠️  Some tests failed. Check the server logs.\n');
  }
}

// Run tests
runTests();
