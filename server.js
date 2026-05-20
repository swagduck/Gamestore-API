const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const mongoSanitize = require('express-mongo-sanitize');
const jwt = require('jsonwebtoken');
const Message = require('./src/models/Message');
const { encrypt, decrypt } = require('./src/utils/encryption');

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
const gameController = require('./src/controllers/gameController');

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 4000;

console.log('🚀 BACKEND STARTING...');

// --- CORS Config (shared for Express & Socket.io) ---
// Chỉ allow đúng origin đã cấu hình, không cho phép wildcard *.vercel.app
const getAllowedOrigins = () => {
  const origins = ['http://localhost:5173', 'http://localhost:5174'];
  if (process.env.FRONTEND_URL) {
    const url = process.env.FRONTEND_URL.replace(/\/$/, ''); // strip trailing slash
    if (!origins.includes(url)) origins.push(url);
  }
  return origins;
};

const corsOptions = {
  origin: function (origin, callback) {
    const allowed = getAllowedOrigins();
    // Allow no-origin requests (curl, Postman, server-to-server)
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  maxAge: 86400
};

// Security & Performance Middlewares
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  contentSecurityPolicy: false,
}));
app.use(compression());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use(cors(corsOptions));

// --- Stripe Webhook MUST be placed before express.json() ---
const orderController = require('./src/controllers/orderController');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), orderController.handleStripeWebhook);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  Object.defineProperty(req, 'query', {
    value: { ...req.query },
    writable: true,
    configurable: true,
    enumerable: true,
  });
  next();
});

app.use(mongoSanitize());

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

// --- SOCKET.IO SETUP ---
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      const allowed = getAllowedOrigins();
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[Socket CORS] Blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

if (process.env.REDIS_URL) {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ Socket.io Redis Adapter enabled');
  }).catch(err => console.error('❌ Redis Adapter error:', err));
}

// Map: userId (string) -> socketId (Fallback for single instance metrics)
const onlineUsers = new Map();

// Inject io into request
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  next();
});

// API Routes
app.get("/api/test", (req, res) => {
  res.json({ message: "API is working!", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api", reviewRoutes);
app.use("/api", orderRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/users", userRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/admin", adminRoutes);
app.post("/api/recommendations", gameController.getRecommendations);

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("🔥 [Global Error]:", err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Lỗi máy chủ nội bộ. Vui lòng thử lại sau.",
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
});

// Global Error Handling Middleware
io.use((socket, next) => {
  try {
    // Lấy token từ cookie (gửi kèm trong handshake)
    const cookieHeader = socket.handshake.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      })
    );
    const token = cookies.token || socket.handshake.auth?.token;
    if (!token) return next(new Error('Không có token xác thực'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Token không hợp lệ'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  onlineUsers.set(userId, socket.id);
  socket.join(userId); // JOIN ROOM "userId" cho phép scale ngang
  console.log(`🟢 User ${userId} connected. Online: ${onlineUsers.size}`);

  socket.broadcast.emit('friend_online', { userId });
  socket.emit('online_users', Array.from(onlineUsers.keys()));

  socket.on('send_message', async (data) => {
    try {
      const { receiverId, content } = data;
      if (!content || !content.trim()) return socket.emit('message_error', { message: 'Nội dung tin nhắn không được để trống' });
      if (content.trim().length > 2000) return socket.emit('message_error', { message: 'Tin nhắn quá dài' });
      if (!receiverId || !/^[a-f\d]{24}$/i.test(receiverId)) return socket.emit('message_error', { message: 'Người nhận không hợp lệ' });
      if (receiverId === userId) return socket.emit('message_error', { message: 'Không thể nhắn tin cho chính mình' });

      const encryptedContent = encrypt(content.trim());
      const message = await Message.create({ sender: userId, receiver: receiverId, content: encryptedContent });
      const User = require('./src/models/User');
      const senderUser = await User.findById(userId).select('name avatar');

      const messageData = {
        _id: message._id, sender: userId, senderName: senderUser ? senderUser.name : 'Người dùng',
        receiver: receiverId, content: content.trim(), // gửi plaintext qua socket
        read: false, createdAt: message.createdAt,
      };

      // Gửi bằng Redis Adapter thông qua Room (io.to)
      io.to(receiverId).emit('receive_message', messageData);
      socket.emit('message_sent', messageData);
    } catch (err) {
      console.error('Lỗi gửi tin nhắn socket:', err);
      socket.emit('message_error', { message: 'Gửi tin nhắn thất bại' });
    }
  });

  socket.on('messages_read', async ({ senderId }) => {
    try {
      await Message.updateMany({ sender: senderId, receiver: userId, read: false }, { $set: { read: true } });
      io.to(senderId).emit('messages_read_ack', { by: userId });
    } catch (err) {
      console.error('Lỗi đánh dấu đã đọc:', err);
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    socket.broadcast.emit('friend_offline', { userId });
    console.log(`🔴 User ${userId} disconnected. Online: ${onlineUsers.size}`);
  });
});

// Start Server
httpServer.listen(PORT, () => {
  console.log(`🚀 API + Socket.io Server đang chạy tại http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => mongoose.connection.close());
});

process.on('SIGINT', () => {
  httpServer.close(() => mongoose.connection.close());
});

