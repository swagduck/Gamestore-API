const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

// Route imports
const gameRoutes = require('./src/routes/gameRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');
const authRoutes = require('./src/routes/authRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const userRoutes = require('./src/routes/userRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const discountRoutes = require('./src/routes/discountRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const gameController = require('./src/controllers/gameController'); // For recommendations

const app = express();
const PORT = process.env.PORT || 4000;

console.log('🚀 BACKEND STARTING...');

// Security & Performance Middlewares
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "unsafe-none" }, 
  contentSecurityPolicy: false,
})); 
app.use(compression());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://my-ecommerce-app-red.vercel.app'
    ];
    if (!origin || allowed.indexOf(origin) !== -1 || origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  maxAge: 86400
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Database Connection
const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  retryWrites: true,
  w: 'majority'
};

mongoose.connect(process.env.MONGO_URI, mongoOptions)
  .then(() => console.log("✅ Kết nối MongoDB Atlas thành công!"))
  .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

// API Routes
app.get("/api/test", (req, res) => {
  res.json({ message: "API is working!", timestamp: new Date().toISOString() });
});

// Modular Routes
app.use("/api/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api", reviewRoutes);
app.use("/api", orderRoutes); // Handled explicitly inside (create-checkout-session, etc.)
app.use("/api/chat", chatRoutes);
app.use("/api/users", userRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/admin", adminRoutes);

// Legacy explicit route for frontend compatibility
app.post("/api/recommendations", gameController.getRecommendations);

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("🔥 [Global Error]:", err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Lỗi máy chủ nội bộ. Vui lòng thử lại sau.",
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`🚀 API Server đang chạy tại http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => mongoose.connection.close());
});

process.on('SIGINT', () => {
  server.close(() => mongoose.connection.close());
});
