/**
 * tests/auth.test.js
 * Kiểm tra các endpoint xác thực: register, login, me.
 * Dùng mongodb-memory-server (setup từ jest.config.js → tests/setup.js).
 */
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

// Import router và model thực tế
const authRoutes = require('../src/routes/authRoutes');
const User = require('../src/models/User');

function buildAuthApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message });
  });
  return app;
}

describe('Auth — Register', () => {
  let app;
  beforeAll(() => { app = buildAuthApp(); });

  test('POST /api/auth/register với body hợp lệ → 201', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'testuser', email: 'test@example.com', password: 'Password123!' });

    // Có thể 201 hoặc 200 tùy controller
    expect([200, 201]).toContain(res.status);
  });

  test('POST /api/auth/register với email trùng → 400', async () => {
    // Register lần 1
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'user1', email: 'dup@example.com', password: 'Password123!' });

    // Register lần 2 cùng email
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'user2', email: 'dup@example.com', password: 'Password456!' });

    expect(res.status).toBe(400);
  });

  test('POST /api/auth/register thiếu password → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'nopass', email: 'nopass@example.com' });

    expect(res.status).toBe(400);
  });
});

describe('Auth — Login', () => {
  let app;
  beforeAll(() => { app = buildAuthApp(); });

  beforeEach(async () => {
    // Tạo user để test login
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'loginuser', email: 'login@example.com', password: 'Password123!' });
  });

  test('POST /api/auth/login đúng credentials → 200 + set cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    // Cookie JWT phải được set
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('POST /api/auth/login sai password → 400 hoặc 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'WrongPassword!' });

    expect([400, 401]).toContain(res.status);
  });

  test('POST /api/auth/login email không tồn tại → 400 hoặc 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Password123!' });

    expect([400, 401]).toContain(res.status);
  });

  test('POST /api/auth/login body rỗng → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('Auth — Me (Protected)', () => {
  let app;
  beforeAll(() => { app = buildAuthApp(); });

  test('GET /api/auth/me không có token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me với token hợp lệ → 200', async () => {
    // Register + login để lấy cookie
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'meuser', email: 'me@example.com', password: 'Password123!' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'me@example.com', password: 'Password123!' });

    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    // API trả về { user: { email, ... } }
    const user = res.body.user || res.body;
    expect(user).toHaveProperty('email', 'me@example.com');
  });
});
