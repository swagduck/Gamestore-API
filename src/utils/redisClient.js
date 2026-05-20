const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL;
let redisClient = null;

if (redisUrl) {
  redisClient = createClient({ url: redisUrl });
  
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  
  redisClient.connect()
    .then(() => console.log('✅ Connected to Redis Cache'))
    .catch(err => console.error('❌ Redis connection error:', err));
}

module.exports = redisClient;
