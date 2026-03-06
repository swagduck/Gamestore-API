const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB connection options with timeout settings
const mongoOptions = {
  serverSelectionTimeoutMS: 5000, // 5 seconds timeout for server selection
  socketTimeoutMS: 45000, // 45 seconds for socket operations
  connectTimeoutMS: 10000, // 10 seconds for initial connection
  retryWrites: true,
  w: 'majority'
};

console.log('Testing MongoDB connection...');
console.log('MONGO_URI:', process.env.MONGO_URI ? 'Set' : 'Not set');

if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment variables');
  console.log('Please check your .env file or Render environment variables');
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URI, mongoOptions)
  .then(() => {
    console.log('✅ MongoDB connection successful!');
    console.log('Connection state:', mongoose.connection.readyState);
    mongoose.disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    
    if (err.message.includes('authentication failed')) {
      console.log('\n🔧 Authentication Error Solutions:');
      console.log('1. Check username and password in MONGO_URI');
      console.log('2. Ensure user has proper permissions in MongoDB Atlas');
      console.log('3. Verify database user is created for the specific cluster');
    }
    
    if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
      console.log('\n🔧 Network Error Solutions:');
      console.log('1. Check cluster URL in MONGO_URI');
      console.log('2. Verify network connectivity');
      console.log('3. Check if MongoDB Atlas cluster is running');
    }
    
    process.exit(1);
  });
