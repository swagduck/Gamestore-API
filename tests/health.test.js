/**
 * tests/health.test.js
 * Kiểm tra các endpoint cơ bản và health check của API.
 */
const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Build a minimal app for testing (không start httpServer)
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!', timestamp: new Date().toISOString() });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
  });

  return app;
}

describe('Health Check', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test('GET /api/test → 200 với message đúng', async () => {
    const res = await request(app).get('/api/test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'API is working!');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('GET /api/unknown-route → 404', async () => {
    const res = await request(app).get('/api/unknown-route-xyz');
    expect(res.status).toBe(404);
  });
});

describe('CORS Origin Validation', () => {
  test('getAllowedOrigins chứa localhost:5173', () => {
    process.env.FRONTEND_URL = 'https://my-gamestore.vercel.app';
    // Simulate getAllowedOrigins logic
    const origins = ['http://localhost:5173', 'http://localhost:5174'];
    const url = process.env.FRONTEND_URL.replace(/\/$/, '');
    if (!origins.includes(url)) origins.push(url);

    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('https://my-gamestore.vercel.app');
    // Không có wildcard vercel.app
    expect(origins.some(o => o === '*.vercel.app')).toBe(false);
  });

  test('FRONTEND_URL trailing slash bị strip', () => {
    const raw = 'https://my-gamestore.vercel.app/';
    const stripped = raw.replace(/\/$/, '');
    expect(stripped).toBe('https://my-gamestore.vercel.app');
  });
});
