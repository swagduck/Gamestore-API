/**
 * tests/setup.js
 * Global Jest setup — dùng mongodb-memory-server để test offline,
 * không kết nối MongoDB Atlas thật.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, afterEach, afterAll } from '@jest/globals';

let mongoServer: MongoMemoryServer;

// Chạy trước toàn bộ test suite
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;
  process.env.JWT_SECRET = 'test-secret-for-jest-only';
  process.env.NODE_ENV = 'test';

  await mongoose.connect(uri);
});

// Xóa sạch data sau mỗi test file
afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// Đóng kết nối sau khi tất cả test xong
afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
