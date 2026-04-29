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
const mongoSanitize = require('express-mongo-sanitize');
const jwt = require('jsonwebtoken');
const Message = require('./src/models/Message');

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
const corsOptions = {
  origin: function (origin, callback) {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:5174'
    ];
    if (process.env.FRONTEND_URL && !allowed.includes(process.env.FRONTEND_URL)) {
      allowed.push(process.env.FRONTEND_URL);
    }
    if (!origin || allowed.indexOf(origin) !== -1 || (origin && origin.includes('vercel.app'))) {
      callback(null, true);
    } else {
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

// --- SOCKET.IO SETUP ---
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      const allowed = ['http://localhost:5173', 'http://localhost:5174'];
      if (process.env.FRONTEND_URL) allowed.push(process.env.FRONTEND_URL);
      if (!origin || allowed.includes(origin) || (origin && origin.includes('vercel.app'))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Map: userId (string) -> socketId
const onlineUsers = new Map();

// Middleware xác thực Socket qua cookie JWT
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
  console.log(`🟢 User ${userId} connected. Online: ${onlineUsers.size}`);

  // Thông báo cho tất cả bạn bè biết mình đang online
  socket.broadcast.emit('friend_online', { userId });

  // Gửi danh sách người đang online cho user vừa kết nối
  socket.emit('online_users', Array.from(onlineUsers.keys()));

  // --- GỬI TIN NHẮN ---
  socket.on('send_message', async (data) => {
    try {
      const { receiverId, content } = data;
      if (!content || !content.trim() || !receiverId) return;

      // Lưu vào DB
      const message = await Message.create({
        sender: userId,
        receiver: receiverId,
        content: content.trim(),
      });

      const messageData = {
        _id: message._id,
        sender: userId,
        receiver: receiverId,
        content: message.content,
        read: false,
        createdAt: message.createdAt,
      };

      // Gửi cho người nhận nếu đang online
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', messageData);
      }

      // Gửi lại cho chính người gửi để confirm
      socket.emit('message_sent', messageData);
    } catch (err) {
      console.error('Lỗi gửi tin nhắn socket:', err);
      socket.emit('message_error', { message: 'Gửi tin nhắn thất bại' });
    }
  });

  // --- ĐÁNH DẤU ĐÃ ĐỌC ---
  socket.on('messages_read', async ({ senderId }) => {
    try {
      await Message.updateMany(
        { sender: senderId, receiver: userId, read: false },
        { $set: { read: true } }
      );
      // Thông báo cho người gửi tin nhắn gốc biết đã được đọc
      const senderSocketId = onlineUsers.get(senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit('messages_read_ack', { by: userId });
      }
    } catch (err) {
      console.error('Lỗi đánh dấu đã đọc:', err);
    }
  });

  // --- DISCONNECT ---
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

