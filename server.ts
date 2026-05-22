import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import mongoSanitize from 'express-mongo-sanitize';
import jwt from 'jsonwebtoken';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      io?: Server;
      onlineUsers?: Map<string, string>;
      user?: any; // Will refine later
    }
  }
}

// Ensure socket has userId
interface CustomSocket extends Socket {
  userId?: string;
}

// Temporary require for models and routes until they are converted to TS
import Message from './src/models/Message';
import { encrypt, decrypt } from './src/utils/encryption';

import gameRoutes from './src/routes/gameRoutes';
import reviewRoutes from './src/routes/reviewRoutes';
import authRoutes from './src/routes/authRoutes';
import orderRoutes from './src/routes/orderRoutes';
import chatRoutes from './src/routes/chatRoutes';
import userRoutes from './src/routes/userRoutes';
import analyticsRoutes from './src/routes/analyticsRoutes';
import notificationRoutes from './src/routes/notificationRoutes';
import discountRoutes from './src/routes/discountRoutes';
import adminRoutes from './src/routes/adminRoutes';
import gameController from './src/controllers/gameController';
import orderController from './src/controllers/orderController';

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 4000;

console.log('🚀 BACKEND STARTING...');

const getAllowedOrigins = (): string[] => {
  const origins = ['http://localhost:5173', 'http://localhost:5174'];
  if (process.env.FRONTEND_URL) {
    const url = process.env.FRONTEND_URL.replace(/\/$/, '');
    if (!origins.includes(url)) origins.push(url);
  }
  return origins;
};

const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    const allowed = getAllowedOrigins();
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

app.use(helmet({
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  contentSecurityPolicy: false,
}));
app.use(compression());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use(cors(corsOptions));

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), orderController.handleStripeWebhook);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

app.use((req: Request, res: Response, next: NextFunction) => {
  Object.defineProperty(req, 'query', {
    value: { ...req.query },
    writable: true,
    configurable: true,
    enumerable: true,
  });
  next();
});

// Protect against NoSQL Injection
app.use(mongoSanitize());

// Protect against HTTP Parameter Pollution attacks
app.use(hpp());

// Global Rate Limiting for all /api routes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: { message: "Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau 15 phút." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  retryWrites: true,
  w: 'majority' as const
};

mongoose.connect(process.env.MONGO_URI as string, mongoOptions)
  .then(() => console.log("✅ Kết nối MongoDB Atlas thành công!"))
  .catch((err: Error) => console.error("❌ Lỗi kết nối MongoDB:", err));

const io = new Server(httpServer, {
  cors: {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
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
  }).catch((err: Error) => console.error('❌ Redis Adapter error:', err));
}

const onlineUsers = new Map<string, string>();

app.use((req: Request, res: Response, next: NextFunction) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  next();
});

app.get("/api/test", (req: Request, res: Response) => {
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

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("🔥 [Global Error]:", err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Lỗi máy chủ nội bộ. Vui lòng thử lại sau.",
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
});

io.use((socket: CustomSocket, next: (err?: Error) => void) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      })
    );
    const token = cookies.token || socket.handshake.auth?.token;
    if (!token) return next(new Error('Không có token xác thực'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string };
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Token không hợp lệ'));
  }
});

io.on('connection', (socket: CustomSocket) => {
  const userId = socket.userId;
  if (!userId) return;

  onlineUsers.set(userId, socket.id);
  socket.join(userId);
  console.log(`🟢 User ${userId} connected. Online: ${onlineUsers.size}`);

  socket.broadcast.emit('friend_online', { userId });
  socket.emit('online_users', Array.from(onlineUsers.keys()));

  socket.on('send_message', async (data: any) => {
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
        receiver: receiverId, content: content.trim(),
        read: false, createdAt: message.createdAt,
      };

      io.to(receiverId).emit('receive_message', messageData);
      socket.emit('message_sent', messageData);
    } catch (err) {
      console.error('Lỗi gửi tin nhắn socket:', err);
      socket.emit('message_error', { message: 'Gửi tin nhắn thất bại' });
    }
  });

  socket.on('messages_read', async ({ senderId }: { senderId: string }) => {
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

httpServer.listen(PORT, () => {
  console.log(`🚀 API + Socket.io Server đang chạy tại http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => mongoose.connection.close());
});

process.on('SIGINT', () => {
  httpServer.close(() => mongoose.connection.close());
});
