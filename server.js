const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const Game = require("./Game.js");
const User = require("./User.js"); // User model for authentication
const Review = require("./Review.js"); // Review model
const Analytics = require("./Analytics.js"); // Analytics model for tracking
const Notification = require("./Notification.js"); // Notification model
const Discount = require("./Discount.js"); // Discount model
const Order = require("./Order.js"); // Order model for user purchase history
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { GoogleGenerativeAI } = require("@google/generative-ai");
const NodeCache = require("node-cache");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const { OAuth2Client } = require('google-auth-library');
const { sendOrderConfirmation } = require('./emailService');

console.log('🚀 BACKEND STARTING... RESEND_API_KEY is:', process.env.RESEND_API_KEY ? 'CONFIGURED' : 'MISSING');

// --- Initialize Google OAuth Client ---
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- Initialize Cache ---
const myCache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // Cache for 5 minutes

// --- Initialize Google AI ---
const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
console.log(`🤖 AI INIT: Key prefix: ${geminiKey.substring(0, 7)}... suffix: ...${geminiKey.substring(geminiKey.length - 4)} (Length: ${geminiKey.length})`);
const genAI = new GoogleGenerativeAI(geminiKey);
// Use the latest Gemini 3.1 model as per Google's migration notice
const chatModelGlobal = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

const app = express();
const PORT = process.env.PORT || 4000;

// --- Middlewares ---
console.log(">>> SERVER: Setting up middleware...");

// Security & Performance
app.use(helmet()); 
app.use(compression());

// Logging (Only use 'dev' format in non-test environments or enable for production)
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
    // Allow if origin is in whitelist or if it contains vercel.app
    if (!origin || allowed.indexOf(origin) !== -1 || origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  maxAge: 86400
}));
console.log(">>> SERVER: CORS middleware applied with specific origins.");
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
console.log(">>> SERVER: JSON and URL-encoded middleware applied.");


// --- Connect to Database ---
console.log(">>> SERVER: Attempting DB connection...");

// MongoDB connection options with timeout settings
const mongoOptions = {
  serverSelectionTimeoutMS: 5000, // 5 seconds timeout for server selection
  socketTimeoutMS: 45000, // 45 seconds for socket operations
  connectTimeoutMS: 10000, // 10 seconds for initial connection
  retryWrites: true,
  w: 'majority'
};

mongoose
  .connect(process.env.MONGO_URI, mongoOptions)
  .then(() => {
    console.log("Kết nối MongoDB Atlas thành công!");
  })
  .catch((err) => {
    console.error("Lỗi kết nối MongoDB:", err);
    // Don't exit the process, let the server continue running
  });

// --- Rate Limiting for Chat API ---
const chatRateLimit = new Map(); // Simple in-memory rate limit

const checkRateLimit = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60000; // 1 minute window
  const maxRequests = 10; // Max 10 requests per minute per IP
  
  if (!chatRateLimit.has(clientIP)) {
    chatRateLimit.set(clientIP, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  const clientData = chatRateLimit.get(clientIP);
  
  if (now > clientData.resetTime) {
    // Reset window
    chatRateLimit.set(clientIP, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  if (clientData.count >= maxRequests) {
    return res.status(429).json({
      text: "Bot đang bận, vui lòng thử lại sau 1 phút!",
      error: "RATE_LIMIT_EXCEEDED"
    });
  }
  
  clientData.count++;
  next();
};

// --- Helper Functions ---
const generateOrderNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `GAMPERS-${date}-${random}`;
};

const syncAnalytics = async (order) => {
  try {
    // Determine the items to sync
    const items = order.items || [];
    
    // Add to Analytics.orders collection
    await Analytics.findOneAndUpdate(
      {},
      {
        $push: {
          orders: {
            _id: order._id.toString(),
            userId: order.user?.toString(),
            items: items.map(item => ({
              gameId: item.game?.toString() || item.gameId,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              finalPrice: item.finalPrice || item.price,
              platform: Array.isArray(item.platform) ? item.platform : [item.platform].filter(Boolean),
              genre: Array.isArray(item.genre) ? item.genre : [item.genre].filter(Boolean)
            })),
            total: order.totalAmount,
            itemCount: items.length,
            date: order.createdAt || new Date(),
            status: order.status || 'completed'
          }
        },
        $set: { lastUpdated: new Date() }
      },
      { upsert: true }
    );
    
    // Update games names cache list in analytics if missing
    for (const item of items) {
      const gId = item.game?.toString() || item.gameId;
      if (gId && item.name) {
        // Only push if this gameId not in the games list already
        const analytics = await Analytics.findOne({});
        const gameExists = analytics?.games?.some(g => g._id === gId);
        if (!gameExists) {
          await Analytics.findOneAndUpdate(
            {},
            { $push: { games: { _id: gId, name: item.name } } }
          );
        }
      }
    }
    console.log(`📊 Analytics synchronized for order: ${order._id}`);
  } catch (error) {
    console.error('⚠️ Could not sync analytics:', error.message);
  }
};


// --- AUTH MIDDLEWARE ---
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ message: "Không có token, không được phép truy cập" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { 
      _id: decoded.userId,
      isAdmin: decoded.isAdmin // Ensure isAdmin is available
    };
    next();
  } catch (error) {
    res.status(401).json({ message: "Token không hợp lệ" });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ message: "Không có token, không được phép truy cập" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: "Yêu cầu quyền admin" });
    }

    req.user = user; // Gắn thông tin user vào request
    next();
  } catch (error) {
    res.status(401).json({ message: "Token không hợp lệ" });
  }
};

// --- API ROUTES ---
console.log(">>> SERVER: Defining API routes...");

// == Test Route (No Database Required) ==
app.get("/api/test", (req, res) => {
  res.json({
    message: "API is working!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongoUriSet: !!process.env.MONGO_URI,
    port: process.env.PORT || 4000
  });
});

// == MANUAL EMAIL TEST ROUTE ==
app.get("/api/test-email-now", async (req, res) => {
  console.log("=== [MANUAL TEST] Endpoint /api/test-email-now hit ===");
  try {
    const email = req.query.email || process.env.EMAIL_USER;
    if (!email) return res.status(400).send("Lỗi: Không tìm thấy email để gửi. Thêm ?email=xxx@gmail.com vào URL.");
    
    console.log(`📡 Attempting to send test email to: ${email}`);
    
    const testOrder = {
      orderNumber: "TEST-CMD-999",
      items: [{ name: "Game Debug Test", finalPrice: 0, price: 0, image: "", quantity: 1 }],
      totalAmount: 0,
      createdAt: new Date()
    };

    await sendOrderConfirmation(email, testOrder);
    res.send(`✅ Lệnh gửi mail đã được phát đi tới ${email}. Kiểm tra Log Render và Inbox/Spam!`);
  } catch (err) {
    console.error("❌ Lỗi trong route test-email-now:", err);
    res.status(500).send("Lỗi Server: " + err.message);
  }
});


// == MANUAL EMAIL TEST ROUTE ==
app.get("/api/test-email-now", async (req, res) => {
  console.log("=== [MANUAL TEST] Endpoint /api/test-email-now hit ===");
  try {
    const email = req.query.email || process.env.EMAIL_USER;
    if (!email) return res.status(400).send("Lỗi: Không tìm thấy email để gửi. Thêm ?email=xxx@gmail.com vào URL.");
    
    console.log(`📡 Attempting to send test email to: ${email}`);
    
    const testOrder = {
      orderNumber: "TEST-CMD-999",
      items: [{ name: "Game Debug Test", finalPrice: 0, price: 0, image: "", quantity: 1 }],
      totalAmount: 0,
      createdAt: new Date()
    };

    await sendOrderConfirmation(email, testOrder);
    res.send(`✅ Lệnh gửi mail đã được phát đi tới ${email}. Kiểm tra Log Render và Inbox/Spam!`);
  } catch (err) {
    console.error("❌ Lỗi trong route test-email-now:", err);
    res.status(500).send("Lỗi Server: " + err.message);
  }
});

// == Database Status Route ==
app.get("/api/status", async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;
    const dbStates = {
      0: 'disconnected',
      1: 'connected', 
      2: 'connecting',
      3: 'disconnecting'
    };
    
    const gameCount = await Game.countDocuments();
    const dbName = mongoose.connection.name;
    const mongoUri = process.env.MONGO_URI ? 'Set' : 'Not set';
    
    res.json({
      database: {
        state: dbStates[dbState],
        name: dbName,
        gameCount: gameCount,
        mongoUriConfigured: mongoUri
      },
      server: {
        status: 'running',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      database: {
        state: 'error',
        mongoUriConfigured: process.env.MONGO_URI ? 'Set' : 'Not set'
      }
    });
  }
});

// == Game Routes (CORRECT ORDER) ==

// 1. GET All Games (with sorting, filtering, and pagination)
app.get("/api/games", async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        message: "Database temporarily unavailable. Please try again later." 
      });
    }

    const { limit, sort, order = "desc" } = req.query;

    const cacheKey = `games_${limit || 'all'}_${sort || 'none'}_${order}`;
    const cachedData = myCache.get(cacheKey);
    if (cachedData) {
      // console.log(`🚀 [Cache Hit] /api/games - ${cacheKey}`);
      return res.json(cachedData);
    }

    let query = Game.find();

    if (sort) {
      const sortOptions = {};
      sortOptions[sort] = order === "desc" ? -1 : 1;
      query = query.sort(sortOptions);
    }

    if (limit) {
      query = query.limit(parseInt(limit, 10));
    }

    const games = await query.exec();
    myCache.set(cacheKey, games); // Lưu vào cache
    res.json(games);
  } catch (err) {
    console.log("Lỗi server /api/games:", err.message);
    if (err.name === 'MongooseServerSelectionError') {
      return res.status(503).json({ 
        message: "Database temporarily unavailable. Please try again later." 
      });
    }
    res.status(500).json({ message: err.message });
  }
});

// 2. GET Games by Query (for Chatbot - Rule Based) - Moved UP
app.get("/api/games/find", async (req, res) => {
  try {
    const { genre, platform } = req.query;
    let query = {};
    // Sử dụng $in để tìm trong mảng
    if (genre) query.genre = { $in: [genre] };
    if (platform) query.platform = { $in: [platform] };
    const games = await Game.find(query).limit(5);
    res.json(games);
  } catch (error) {
    console.error("Lỗi khi tìm game (chatbot):", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// 3. GET Search Games
app.get("/api/games/search", async (req, res) => {
  console.log(">>> SEARCH ROUTE HIT <<<");
  try {
    const query = req.query.q;
    console.log(`Search query received: "${query}"`);

    if (!query) {
      console.log("Search query is missing!");
      return res.status(400).json({ message: "Search query is required" });
    }

    console.log(`Attempting MongoDB regex search for: "${query}"`);
    
    // Use regex for case-insensitive partial matching
    const searchRegex = new RegExp(query, 'i');
    const games = await Game.find({
      $or: [
        { name: searchRegex },
        { description: searchRegex },
        { genre: searchRegex }
      ]
    }).limit(10);

    console.log(`MongoDB find completed. Found ${games.length} games.`);
    res.json(games);
  } catch (error) {
    console.error("!!! DETAILED SEARCH ERROR:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi tìm kiếm game." });
  }
});

// 4. GET Discounted & Free Games Only
app.get("/api/games/discounted", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: "Database temporarily unavailable. Please try again later."
      });
    }

    const now = new Date();

    // Find games that are free OR have an active discount
    const games = await Game.find({
      $or: [
        { isFree: true },
        {
          discountType: { $in: ['percentage', 'fixed'] },
          discountValue: { $gt: 0 },
          $and: [
            { $or: [{ discountStartDate: null }, { discountStartDate: { $lte: now } }] },
            { $or: [{ discountEndDate: null }, { discountEndDate: { $gte: now } }] }
          ]
        }
      ]
    });

    console.log(`🎯 Discounted/Free games found: ${games.length}`);
    res.json(games);
  } catch (err) {
    console.error("Lỗi khi lấy game giảm giá:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// == Review Routes ==

// GET all reviews for a game
app.get("/api/games/:id/reviews", async (req, res) => {
  try {
    const cacheKey = `reviews_${req.params.id}`;
    const cachedData = myCache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const reviews = await Review.find({ game: req.params.id })
      .populate("user", "email")
      .sort({ createdAt: -1 });

    myCache.set(cacheKey, reviews);
    res.json(reviews);
  } catch (error) {
    console.error("Lỗi khi lấy đánh giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// Mark a review as helpful
app.put("/api/reviews/:id/helpful", async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $inc: { helpful: 1 } },
      { new: true }
    );
    if (!review) {
      return res.status(404).json({ message: "Không tìm thấy đánh giá." });
    }
    res.json(review);
  } catch (error) {
    console.error("Lỗi khi cập nhật hữu ích:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// Report a review
app.post("/api/reviews/:id/report", async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $inc: { reportCount: 1 } },
      { new: true }
    );
    if (!review) {
      return res.status(404).json({ message: "Không tìm thấy đánh giá." });
    }
    res.json({ message: "Đã báo cáo đánh giá thành công." });
  } catch (error) {
    console.error("Lỗi khi báo cáo đánh giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// POST create a new review for a game (logged-in users)
app.post("/api/games/:id/reviews", verifyToken, async (req, res) => {
  const { rating, comment } = req.body;
  const gameId = req.params.id;
  const userId = req.user._id;

  try {
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: "Không tìm thấy game." });
    }

    let review = await Review.findOne({
      game: gameId,
      user: userId,
    });

    if (review) {
      // Cập nhật đánh giá hiện có
      review.rating = Number(rating);
      review.comment = comment;
      await review.save();
    } else {
      // Tạo đánh giá mới
      review = new Review({
        game: gameId,
        user: userId,
        rating: Number(rating),
        comment,
      });
      await review.save();
    }

    // Update game's rating and numReviews
    const reviews = await Review.find({ game: gameId });
    game.numReviews = reviews.length;
    game.rating =
      reviews.reduce((acc, item) => item.rating + acc, 0) / reviews.length;

    await game.save();

    // Xóa cache đánh giá để user thấy cái mới ngay
    myCache.del(`reviews_${gameId}`);

    res.status(review.isNew ? 201 : 200).json({ 
      message: review.isNew ? "Cảm ơn bạn đã đánh giá!" : "Đã cập nhật đánh giá của bạn!",
      review 
    });
  } catch (error) {
    console.error("Lỗi khi thêm đánh giá:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi thêm đánh giá." });
  }
});

// Track game view - increment viewCount directly in game
app.post("/api/games/:id/view", async (req, res) => {
  try {
    const { id } = req.params;
    
    const game = await Game.findByIdAndUpdate(
      id,
      { $inc: { viewCount: 1 } },
      { new: true }
    );
    
    if (!game) {
      return res.status(404).json({ message: "Game không tồn tại." });
    }
    
    console.log(`🎮 Incremented viewCount for ${game.name} to ${game.viewCount}`);
    
    res.json({ 
      message: "Lượt xem đã được ghi nhận.",
      viewCount: game.viewCount,
      gameName: game.name
    });
  } catch (error) {
    console.error("Lỗi khi ghi nhận lượt xem:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận lượt xem." });
  }
});

// 4. GET Single Game by ID
app.get("/api/games/:id", async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ message: "Không tìm thấy game" });
    res.json(game);
  } catch (err) {
    // Handle potential CastError if ID format is wrong
    if (err.name === "CastError") {
      console.error("Invalid ID format:", req.params.id);
      return res.status(400).json({ message: "ID game không hợp lệ." });
    }
    console.error("Error fetching single game:", err);
    res.status(500).json({ message: err.message });
  }
});

// POST Add New Game (Admin)
app.post("/api/games", verifyAdmin, async (req, res) => {
  const newGameData = req.body;
  try {
    const game = new Game(newGameData);
    await game.save();
    res.status(201).json(game);
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    console.error("Error adding game:", err);
    res.status(500).json({ message: err.message });
  }
});

// PUT Update Game (Admin)
app.put("/api/games/:id", verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const updatedGameData = req.body;
  try {
    const updatedGame = await Game.findByIdAndUpdate(id, updatedGameData, {
      new: true,
      runValidators: true,
    });
    if (!updatedGame) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy game để cập nhật" });
    }
    res.json(updatedGame);
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    if (err.name === "CastError") {
      console.error("Invalid ID format for update:", id);
      return res.status(400).json({ message: "ID game không hợp lệ." });
    }
    console.error("Error updating game:", err);
    res.status(500).json({ message: err.message });
  }
});

// DELETE Game (Admin)
app.delete("/api/games/:id", verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const deletedGame = await Game.findByIdAndDelete(id);
    if (!deletedGame) {
      return res.status(404).json({ message: "Không tìm thấy game để xóa" });
    }
    res.json({ message: "Đã xóa game thành công" });
  } catch (err) {
    if (err.name === "CastError") {
      console.error("Invalid ID format for delete:", id);
      return res.status(400).json({ message: "ID game không hợp lệ." });
    }
    console.error("Error deleting game:", err);
    res.status(500).json({ message: err.message });
  }
});

// == Recommendation Route ==
app.post("/api/recommendations", async (req, res) => {
  try {
    const { cartItems } = req.body;
    if (!cartItems || cartItems.length === 0) {
      return res.json([]);
    }
    const currentIds = cartItems.map((item) => item._id);
    const currentGenres = [...new Set(cartItems.flatMap((item) => item.genre))];
    const recommendations = await Game.find({
      genre: { $in: currentGenres },
      _id: { $nin: currentIds },
    }).limit(5);
    res.json(recommendations);
  } catch (error) {
    console.error("Lỗi khi tạo đề xuất:", error);
    res.status(500).json({ message: "Không thể tạo đề xuất" });
  }
});

// Test endpoint for payment (without Stripe)
app.post("/api/test-payment", verifyToken, async (req, res) => {
  try {
    const { cartItems } = req.body;
    const userId = req.user._id;
    console.log('Test payment received:', cartItems);
    
    const processedItems = cartItems.map((item) => {
      let finalPrice = item.price;
      
      if (item.discountType && item.discountType !== 'none') {
        const now = new Date();
        const start = item.discountStartDate ? new Date(item.discountStartDate) : null;
        const end = item.discountEndDate ? new Date(item.discountEndDate) : null;
        
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        
        if (isDiscountActive) {
          if (item.discountType === 'percentage') {
            finalPrice = item.price * (1 - item.discountValue / 100);
          } else if (item.discountType === 'fixed') {
            finalPrice = Math.max(0, item.price - item.discountValue);
          }
        }
      }
      
      return {
        name: item.name,
        originalPrice: item.price,
        discountedPrice: finalPrice,
        quantity: item.quantity
      };
    });
    
    const total = processedItems.reduce((sum, item) => sum + item.discountedPrice * item.quantity, 0);
    
    // Generate test session ID
    const testSessionId = `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create order for test payment
    try {
      const orderItems = cartItems.map(item => {
        let finalPrice = item.price;
        
        if (item.discountType && item.discountType !== 'none') {
          const now = new Date();
          const start = item.discountStartDate ? new Date(item.discountStartDate) : null;
          const end = item.discountEndDate ? new Date(item.discountEndDate) : null;
          const isDiscountActive = (!start || now >= start) && (!end || now <= end);
          
          if (isDiscountActive) {
            if (item.discountType === 'percentage') {
              finalPrice = item.price * (1 - item.discountValue / 100);
            } else if (item.discountType === 'fixed') {
              finalPrice = Math.max(0, item.price - item.discountValue);
            }
          }
        }
        
        return {
          game: item._id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image,
          discountType: item.discountType || 'none',
          discountValue: item.discountValue || 0,
          finalPrice: finalPrice
        };
      });
      
      const order = new Order({
        user: userId,
        orderNumber: generateOrderNumber(),
        items: orderItems,
        totalAmount: total,
        paymentMethod: 'test',
        paymentId: testSessionId,
        status: 'completed'
      });
      
      await order.save();
      console.log(`✅ Test order created: ${order._id} for user ${userId}`);

      // Send confirmation email (non-blocking)
      try {
        const userDoc = await User.findById(userId).select('email');
        if (userDoc?.email) {
          sendOrderConfirmation(userDoc.email, order);
        }
      } catch (emailErr) {
        console.warn('Could not send test order email:', emailErr.message);
      }
      
    } catch (orderError) {
      console.error('Error creating test order:', orderError);
      // Continue with payment response even if order creation fails
    }
    
    res.json({
      success: true,
      items: processedItems,
      totalAmount: total,
      sessionId: testSessionId, // Add session ID for frontend
      message: "Test payment successful"
    });
  } catch (error) {
    console.error('Test payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// == Stripe Checkout Route ==
app.post("/api/create-checkout-session", verifyToken, async (req, res) => {
  try {
    const { cartItems } = req.body;

    // Check for already-owned games before checkout
    const userId = req.user?._id;
    if (userId) {
      const completedOrders = await Order.find({ user: userId, status: 'completed' });
      const ownedGameIds = new Set();
      completedOrders.forEach(order => {
        order.items.forEach(item => {
          if (item.game) ownedGameIds.add(item.game.toString());
        });
      });

      const alreadyOwned = cartItems.filter(item => ownedGameIds.has(item._id));
      if (alreadyOwned.length > 0) {
        return res.status(400).json({
          message: `Bạn đã sở hữu: ${alreadyOwned.map(g => g.name).join(', ')}. Vui lòng xóa khỏi giỏ hàng.`,
          ownedGames: alreadyOwned.map(g => g._id)
        });
      }
    }

    const line_items = cartItems.map((item) => {
      // Calculate discounted price
      let finalPrice = item.price;
      
      // Check if discount is active
      if (item.discountType && item.discountType !== 'none') {
        const now = new Date();
        const start = item.discountStartDate ? new Date(item.discountStartDate) : null;
        const end = item.discountEndDate ? new Date(item.discountEndDate) : null;
        
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        
        if (isDiscountActive) {
          if (item.discountType === 'percentage') {
            finalPrice = item.price * (1 - item.discountValue / 100);
          } else if (item.discountType === 'fixed') {
            finalPrice = Math.max(0, item.price - item.discountValue);
          }
        }
      }

      // Basic validation for image URL
      let imageUrl = item.image;
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
        // If it starts with / it's a relative path, prepend frontend URL
        if (typeof imageUrl === "string" && imageUrl.startsWith("/")) {
          imageUrl = `${process.env.FRONTEND_URL}${imageUrl}`;
        } else {
          console.warn(`Invalid image URL for ${item.name}: ${imageUrl}. Using placeholder.`);
          imageUrl = "https://via.placeholder.com/200x200?text=" + encodeURIComponent(item.name);
        }
      }

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            images: [imageUrl], // Must be an array of absolute URLs
            metadata: {
              platform: Array.isArray(item.platform)
                ? item.platform.join(", ")
                : item.platform,
              id: item._id,
              originalPrice: item.price,
              discountedPrice: finalPrice,
              discountType: item.discountType || 'none',
              discountValue: item.discountValue || 0,
            },
          },
          unit_amount: Math.round(finalPrice * 100), // Use discounted price in cents
        },
        quantity: item.quantity,
      };
    });
    // Clean FRONTEND_URL by removing trailing slash if it exists
    const frontendBase = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      success_url: `${frontendBase}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase}/cancel`,
      metadata: {
        userId: req.user?._id?.toString() || 'guest' // Include user ID in metadata
      },
      client_reference_id: req.user?._id?.toString() || 'guest' // Alternative way to track user
    });
    res.json({ url: session.url }); // Return the checkout session URL
  } catch (error) {
    console.error("Lỗi khi tạo phiên Stripe:", error);
    res.status(500).json({ message: "Không thể tạo phiên thanh toán" });
  }
});

// == Order Creation from Frontend Success Page ==
app.post("/api/orders/create-from-session", verifyToken, async (req, res) => {
  try {
    const { sessionId, cartItems } = req.body;
    const userId = req.user._id;
    
    if (!sessionId || !cartItems || !Array.isArray(cartItems)) {
      return res.status(400).json({ message: "Session ID và cart items là bắt buộc" });
    }
    
    // Verify the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ message: "Session không hợp lệ hoặc thanh toán chưa hoàn thành" });
    }
    
    // Check if order already exists for this session
    const existingOrder = await Order.findOne({ paymentId: sessionId });
    if (existingOrder) {
      // Even if order exists, try to send confirmation email if not sent yet
      try {
        const userDoc = await User.findById(userId).select('email');
        if (userDoc?.email) {
          sendOrderConfirmation(userDoc.email, existingOrder);
        }
      } catch (e) { console.error('Email retry failed'); }
      
      return res.json(existingOrder); // Return existing order
    }
    
    // Calculate total and prepare order items
    let totalAmount = 0;
    const orderItems = cartItems.map(item => {
      let finalPrice = item.price;
      
      // Validate item has required fields (allow price 0 for free games)
      if (!item._id || !item.name || item.price === undefined || !item.quantity) {
        throw new Error(`Item thiếu thông tin bắt buộc: ${JSON.stringify(item)}`);
      }
      
      // Apply discount if active
      if (item.discountType && item.discountType !== 'none') {
        const now = new Date();
        const start = item.discountStartDate ? new Date(item.discountStartDate) : null;
        const end = item.discountEndDate ? new Date(item.discountEndDate) : null;
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        
        if (isDiscountActive) {
          if (item.discountType === 'percentage') {
            finalPrice = item.price * (1 - item.discountValue / 100);
          } else if (item.discountType === 'fixed') {
            finalPrice = Math.max(0, item.price - item.discountValue);
          }
        }
      }
      
      totalAmount += finalPrice * item.quantity;
      
      return {
        game: item._id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        image: item.image || '',
        discountType: item.discountType || 'none',
        discountValue: item.discountValue || 0,
        finalPrice: finalPrice
      };
    });
    
    // Create order
    const order = new Order({
      user: userId,
      orderNumber: generateOrderNumber(),
      items: orderItems,
      totalAmount,
      paymentMethod: 'stripe',
      paymentId: sessionId,
      status: 'completed'
    });
    
    await order.save();
    
    // Try to populate game details, but handle errors gracefully
    try {
      await order.populate('items.game', 'name genre image rating');
    } catch (populateError) {
      console.warn('⚠️ Could not populate game details:', populateError.message);
      // Continue without population - the order is still saved
    }
    
    console.log(`✅ Order created from frontend: ${order._id} for user ${userId}`);
    
    // Update analytics
    await syncAnalytics(order);

    // Send confirmation email (non-blocking)
    try {
      const userDoc = await User.findById(userId).select('email');
      if (userDoc?.email) {
        sendOrderConfirmation(userDoc.email, order);
      }
    } catch (emailErr) {
      console.warn('Could not fetch user email for confirmation:', emailErr.message);
    }
    
    res.status(201).json(order);
  } catch (error) {
    console.error("Lỗi khi tạo đơn hàng từ session:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi tạo đơn hàng" });
  }
});

// == Stripe Webhook for Payment Completion ==
app.post("/api/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook signature verification failed.`);
  }

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      
      try {
        // Check if order already exists for this session
        const existingOrder = await Order.findOne({ paymentId: session.id });
        if (existingOrder && existingOrder.items.length > 0) {
          console.log(`⚠️ Order already exists and populated for session ${session.id}: ${existingOrder._id}`);
          break;
        }
        
        // Get user ID from multiple sources
        let userId = session.metadata?.userId || session.client_reference_id;
        
        // Only create or update order if we have a valid user ID (not 'guest')
        if (userId && userId !== 'guest') {
          // Fetch line items to get products
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
            expand: ['data.price.product']
          });

          const orderItems = lineItems.data.map(item => {
            const product = item.price.product;
            const metadata = product.metadata || {};
            
            return {
              game: metadata.id,
              name: item.description,
              price: parseFloat(metadata.originalPrice) || (item.amount_total / 100 / item.quantity),
              quantity: item.quantity,
              image: product.images?.[0] || 'https://via.placeholder.com/200x200?text=Game',
              discountType: metadata.discountType || 'none',
              discountValue: parseFloat(metadata.discountValue) || 0,
              finalPrice: item.amount_total / 100 / item.quantity
            };
          });

          if (existingOrder) {
            // Update the basic order created previously (if any)
            existingOrder.items = orderItems;
            existingOrder.totalAmount = session.amount_total / 100;
            await existingOrder.save();
            console.log(`✅ Order updated from webhook with ${orderItems.length} items: ${existingOrder._id}`);
          } else {
            // Create a new order if it doesn't exist
            const orderData = {
              user: userId,
              orderNumber: generateOrderNumber(),
              items: orderItems,
              totalAmount: session.amount_total / 100,
              paymentMethod: "stripe",
              paymentId: session.id,
              status: "completed"
            };
            
            const order = new Order(orderData);
            await order.save();
            console.log(`✅ Order created from webhook with ${orderItems.length} items for user ${userId}: ${order._id}`);

            // Send confirmation email from webhook
            try {
              const userDoc = await User.findById(userId).select('email');
              if (userDoc?.email) {
                sendOrderConfirmation(userDoc.email, order);
              }
            } catch (emailErr) {
              console.warn('Webhook email failed:', emailErr.message);
            }

            // Update analytics
            await syncAnalytics(order);
          }
        } else {
          console.log(`⚠️ No valid user ID found in session ${session.id}, skipping order creation`);
        }
      } catch (error) {
        console.error("Error processing checkout.session.completed webhook:", error);
      }
      break;

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      const failedSession = event.data.object;
      console.log(`❌ Payment failed for session: ${failedSession.id}`);
      
      // Update order status to failed if it exists
      try {
        await Order.findOneAndUpdate(
          { paymentId: failedSession.id },
          { status: "failed", updatedAt: new Date() }
        );
      } catch (error) {
        console.error("Error updating failed order:", error);
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.send();
});

// == Chatbot Route (Gemini AI) ==
app.post("/api/chat", checkRateLimit, async (req, res) => {
  try {
    const { message, history } = req.body;
    
    // 1. Lấy thông tin user (tùy chọn) để cá nhân hóa
    let userContext = "Khách vãng lai";
    let ownedGamesList = "";
    
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (user) {
          userContext = `Tên: ${user.name || 'Người dùng'}, Email: ${user.email}`;
          
          // Lấy danh sách game đã mua để tư vấn chuẩn hơn
          const userOrders = await Order.find({ user: user._id, status: 'completed' });
          const ownedSet = new Set();
          userOrders.forEach(order => {
            order.items.forEach(item => ownedSet.add(item.name));
          });
          if (ownedSet.size > 0) {
            ownedGamesList = `Người dùng này đã sở hữu: ${Array.from(ownedSet).join(", ")}. Đừng gợi ý lại những game này trừ khi họ hỏi.`;
          }
        }
      } catch (e) {
        // Token lỗi thì thôi
      }
    }

    // 2. Lấy "Kiến thức nền" (Top 15 game) để AI biết tư vấn sâu
    const topGames = await Game.find({}).sort({ rating: -1, viewCount: -1 }).limit(15);
    const gamesKnowledge = topGames.map(g => 
      `- ${g.name}: [Thể loại: ${g.genre.join(", ")}], [Giá: $${g.price}], [Đánh giá: ${g.rating}/5], Mô tả: ${g.description.substring(0, 100)}...`
    ).join("\n");

    // 3. Nâng cấp System Prompt
    const systemPrompt = `Bạn là GameBot 🤖 - Chuyên gia tư vấn game cao cấp của Gam34Pers.
NHIỆM VỤ: Phân tích nhu cầu, so sánh game và đưa ra lời khuyên "CÓ GU" cho khách hàng. Đừng chỉ là một thanh tìm kiếm!

THÔNG TIN NGƯỜI DÙNG HIỆN TẠI:
- Trạng thái: ${userContext}
- ${ownedGamesList}

KIẾN THỨC VỀ CÁC GAME TRONG CỬA HÀNG (Dùng để tư vấn & so sánh):
${gamesKnowledge}

QUY TẮC PHẢN HỒI (CHỈ TRẢ VỀ JSON):
{
  "response": "Lời tư vấn tiếng Việt sâu sắc, thân thiện. Hãy biết so sánh game, nhắc đến ưu điểm của các game bạn biết ở trên. Có thể chào tên người dùng nếu có.",
  "query": { "genre": "thể loại tiếng Việt", "platform": "PC/PS5/Xbox/Switch", "name": "tên game" }
}
LUÔN TRẢ VỀ JSON. Nếu chỉ là tư vấn/so sánh, 'query' có thể để rỗng {}.`;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ text: "AI service not configured" });
    }

    let formattedHistory = (history || [])
      .filter(m => m.id !== 1)
      .map(m => ({ role: m.from === "user" ? "user" : "model", parts: [{ text: m.text }] }));

    const firstUserIdx = formattedHistory.findIndex(msg => msg.role === 'user');
    if (firstUserIdx !== -1) {
      formattedHistory = formattedHistory.slice(firstUserIdx);
    } else {
      formattedHistory = [];
    }

    formattedHistory = formattedHistory.slice(-10);
    while (formattedHistory.length > 0 && formattedHistory[0].role !== 'user') {
      formattedHistory.shift();
    }

    const chat = chatModelGlobal.startChat({
      history: formattedHistory,
      systemInstruction: { parts: [{ text: systemPrompt }] },
    });

    const result = await chat.sendMessage(message);
    const aiResponseText = result.response.text();

    let aiJson;
    try {
      const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
         aiJson = JSON.parse(jsonMatch[0]);
      } else {
         throw new Error("No JSON");
      }
    } catch (e) {
      return res.json({
        text: aiResponseText.replace(/```json|```/g, "").trim() || "Chào bạn! Mình có thể giúp gì được cho bạn?",
        results: [],
      });
    }

    let gameResults = [];
    if (aiJson.query && (aiJson.query.genre || aiJson.query.platform || aiJson.query.name)) {
      const dbQuery = {};
      if (aiJson.query.genre) dbQuery.genre = { $regex: new RegExp(aiJson.query.genre, "i") };
      if (aiJson.query.platform) dbQuery.platform = { $regex: new RegExp(aiJson.query.platform, "i") };
      if (aiJson.query.name) dbQuery.name = { $regex: new RegExp(aiJson.query.name, "i") };
      
      gameResults = await Game.find(dbQuery).limit(5);
    }

    res.json({
      text: aiJson.response || "Mời bạn tham khảo các tựa game này nhé!",
      results: gameResults,
    });
  } catch (error) {
    console.error('❌ Chatbot Error:', error.message);
    res.status(500).json({ text: "Hệ thống AI đang bận chút, bạn thử lại sau nhen! 🤖" });
  }
});

// == Order Routes ==

// GET user's order history (authenticated users only)
app.get("/api/orders", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;
    
    // Build query
    const query = { user: userId };
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    const orders = await Order.find(query)
      .populate('items.game', 'name genre image rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Order.countDocuments(query);
    
    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Lỗi khi lấy lịch sử đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy lịch sử đơn hàng" });
  }
});

// GET user's purchased games for recommendations
app.get("/api/orders/purchased-games", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get all completed orders
    const orders = await Order.find({ 
      user: userId, 
      status: 'completed' 
    }).populate('items.game', 'name genre image rating platform');
    
    // Extract unique games
    const purchasedGames = [];
    const gameIds = new Set();
    
    orders.forEach(order => {
      order.items.forEach(item => {
        if (item.game && !gameIds.has(item.game._id.toString())) {
          gameIds.add(item.game._id.toString());
          purchasedGames.push({
            ...item.game.toObject(),
            purchasedAt: order.createdAt,
            price: item.finalPrice || item.price
          });
        }
      });
    });
    
    res.json(purchasedGames);
  } catch (error) {
    console.error("Lỗi khi lấy game đã mua:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy game đã mua" });
  }
});

// GET owned game IDs only (lightweight)
app.get("/api/orders/owned-game-ids", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const orders = await Order.find({ user: userId, status: 'completed' });
    
    const ownedIds = new Set();
    orders.forEach(order => {
      order.items.forEach(item => {
        if (item.game) ownedIds.add(item.game.toString());
      });
    });
    
    res.json([...ownedIds]);
  } catch (error) {
    console.error("Lỗi khi lấy owned game IDs:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// ==Admin: GET all orders (admin only) ==
app.get("/api/admin/orders", verifyAdmin, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ message: "Không có quyền truy cập" });

    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .populate('user', 'email')
      .populate('items.game', 'name image price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Lỗi admin orders:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// == Admin: AI Summary Insight ==
app.get("/api/admin/ai-summary", verifyAdmin, async (req, res) => {
  try {
    // 1. Thu thập dữ liệu thô
    const completedOrders = await Order.find({ status: 'completed' }).populate('items.game');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalOrders = completedOrders.length;
    
    // Thống kê game
    const gameSales = {};
    completedOrders.forEach(o => {
      o.items.forEach(item => {
        const name = item.name || 'Unknown';
        gameSales[name] = (gameSales[name] || 0) + (item.finalPrice || 1);
      });
    });
    
    // Lấy top 5 game doanh thu cao
    const topGames = Object.entries(gameSales)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, rev]) => `${name} ($${rev.toFixed(2)})`)
      .join(", ");

    const analyticsData = `
      - Tổng doanh thu: $${(totalRevenue || 0).toFixed(2)}
      - Tổng đơn hàng: ${totalOrders || 0}
      - Top game doanh thu: ${topGames || 'Chưa có dữ liệu'}
    `;

    const systemPrompt = `Bạn là Chuyên gia Phân tích Kinh doanh AI của Gam34Pers. 
NHIỆM VỤ: Dựa trên dữ liệu doanh thu, hãy viết một bản tóm tắt tình hình kinh doanh "CÓ TÂM" cho chủ shop.
- Đánh giá nhanh tình hình (tốt/xấu).
- Chỉ ra điểm sáng (game bán chạy).
- Đưa ra 1 lời khuyên marketing hoặc nhập hàng thực tế.
TRÌNH BÀY: Ngắn gọn, súc tích (khoảng 3-4 câu), dùng emoji chuyên nghiệp.`;

    // 4. Gọi AI với logic phòng vệ (Retry/Error Handling)
    try {
      const fullPrompt = `${systemPrompt}\n\nDữ liệu thống kê hôm nay:\n${analyticsData}`;
      const result = await chatModelGlobal.generateContent(fullPrompt);
      const summary = result.response.text();
      res.json({ summary });
    } catch (aiError) {
      if (aiError.status === 503 || aiError.message?.includes("503")) {
        console.warn("⚠️ Gemini busy (503)");
        return res.status(503).json({ message: "🔮 AI Gemini hiện đang quá tải lượt gọi (Dưới 10 lượt/phút cho gói Free). Bạn hãy thử lại sau ít phút nhé! ⌛" });
      }
      throw aiError; 
    }
  } catch (error) {
    console.error("❌ Lỗi AI Summary:", error.message);
    res.status(500).json({ message: "AI đang bận phân tích số liệu, vui lòng quay lại sau! 📉" });
  }
});

// == Admin: Revenue stats ==
app.get("/api/admin/stats", verifyAdmin, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ message: "Không có quyền truy cập" });

    const completedOrders = await Order.find({ status: 'completed' })
      .populate('items.game', 'name image price genre');

    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalOrders = completedOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Top selling games
    const gameSalesMap = {};
    completedOrders.forEach(order => {
      order.items.forEach(item => {
        const gameId = item.game?._id?.toString() || item.game?.toString();
        const gameName = item.game?.name || item.name || 'Unknown';
        const gameImage = item.game?.image || item.image || '';
        const price = item.finalPrice || item.price || 0;
        if (gameId) {
          if (!gameSalesMap[gameId]) {
            gameSalesMap[gameId] = { _id: gameId, name: gameName, image: gameImage, sold: 0, revenue: 0 };
          }
          gameSalesMap[gameId].sold += 1;
          gameSalesMap[gameId].revenue += price;
        }
      });
    });
    const topSelling = Object.values(gameSalesMap)
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 10);

    res.json({ totalRevenue, totalOrders, avgOrderValue, topSelling });
  } catch (error) {
    console.error("Lỗi admin stats:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});


// GET single order details
app.get("/api/orders/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const orderId = req.params.id;
    
    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('items.game', 'name genre image rating description platform');
    
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }
    
    res.json(order);
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy chi tiết đơn hàng" });
  }
});

// POST create new order (used by payment success)
app.post("/api/orders", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { items, totalAmount, paymentMethod, paymentId, status = 'pending' } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Giỏ hàng trống" });
    }
    
    // Validate items
    for (const item of items) {
      if (!item.game || !item.name || !item.price || !item.quantity) {
        return res.status(400).json({ message: "Thông tin sản phẩm không hợp lệ" });
      }
    }
    
    const order = new Order({
      user: userId,
      orderNumber: generateOrderNumber(),
      items,
      totalAmount,
      paymentMethod,
      paymentId: paymentId || `manual_${Date.now()}`,
      status
    });
    
    await order.save();
    
    // Populate game details for response
    await order.populate('items.game', 'name genre image rating');
    
    // Update analytics
    await syncAnalytics(order);
    
    res.status(201).json(order);
  } catch (error) {
    console.error("Lỗi khi tạo đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi tạo đơn hàng" });
  }
});

// PUT update order status (for payment completion/failure)
app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    
    if (!['pending', 'completed', 'failed', 'refunded'].includes(status)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ" });
    }
    
    const order = await Order.findByIdAndUpdate(
      orderId,
      { status, updatedAt: new Date() },
      { new: true }
    ).populate('items.game', 'name genre image rating');
    
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }
    
    res.json(order);
  } catch (error) {
    console.error("Lỗi khi cập nhật trạng thái đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật trạng thái đơn hàng" });
  }
});

// == User Management Routes (Admin Only) ==

// GET all users (with optional date range filtering)
app.get("/api/users", verifyAdmin, async (req, res) => {
  try {
    const { startYear, endYear, startMonth, endMonth, startDay, endDay } = req.query;
    let query = {};

    if (startYear || endYear || startMonth || endMonth || startDay || endDay) {
      // Mặc định từ đầu năm 2024 đến hiện tại nếu không cung cấp cụ thể
      const startDate = new Date(2024, 0, 1, 0, 0, 0, 0);
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      if (startYear) startDate.setFullYear(parseInt(startYear));
      if (startMonth) startDate.setMonth(parseInt(startMonth) - 1);
      if (startDay) startDate.setDate(parseInt(startDay));
      startDate.setHours(0, 0, 0, 0);

      if (endYear) endDate.setFullYear(parseInt(endYear));
      if (endMonth) endDate.setMonth(parseInt(endMonth) - 1);
      if (endDay) endDate.setDate(parseInt(endDay));
      endDate.setHours(23, 59, 59, 999);

      query.createdAt = { $gte: startDate, $lte: endDate };
    }

    const users = await User.find(query, "-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách người dùng:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// PUT toggle admin status for a user
app.put("/api/users/:id/toggle-admin", verifyAdmin, async (req, res) => {
  try {
    const userToUpdate = await User.findById(req.params.id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "Không tìm thấy người dùng." });
    }

    // Không cho phép admin tự tước quyền của chính mình
    if (userToUpdate._id.equals(req.user._id)) {
      return res
        .status(400)
        .json({ message: "Không thể tự tước quyền admin của chính mình." });
    }

    userToUpdate.isAdmin = !userToUpdate.isAdmin;
    await userToUpdate.save();

    // Trả về user đã được cập nhật (không có password)
    const updatedUser = userToUpdate.toObject();
    delete updatedUser.password;

    res.json(updatedUser);
  } catch (error) {
    console.error("Lỗi khi thay đổi quyền admin:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// == Authentication Routes ==

// POST Register User
app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res
      .status(400)
      .json({ message: "Email và mật khẩu (ít nhất 6 ký tự) là bắt buộc." });
  }
  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: "Email này đã được đăng ký." });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      isAdmin: false,
    });
    const savedUser = await newUser.save();
    const token = jwt.sign(
      { userId: savedUser._id, email: savedUser.email, isAdmin: savedUser.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.status(201).json({
      message: "Đăng ký thành công!",
      token: token,
      user: { id: savedUser._id, email: savedUser.email, isAdmin: savedUser.isAdmin },
    });
  } catch (error) {
    console.error("Lỗi đăng ký:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi đăng ký." });
  }
});

// POST Login User
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Vui lòng cung cấp email và mật khẩu." });
  }
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res
        .status(400)
        .json({ message: "Email hoặc mật khẩu không đúng." });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ message: "Email hoặc mật khẩu không đúng." });
    }
    const token = jwt.sign(
      { userId: user._id, email: user.email, isAdmin: user.isAdmin }, // Thêm isAdmin vào payload
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      message: "Đăng nhập thành công!",
      token: token,
      user: { id: user._id, email: user.email, isAdmin: user.isAdmin }, // Trả về isAdmin
    });
  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi đăng nhập." });
  }
});

// ==========================================
// THÊM: ROUTE ĐĂNG NHẬP BẰNG GOOGLE (OAUTH2)
// ==========================================
app.post("/api/auth/google", async (req, res) => {
  try {
    const { token } = req.body;

    // 1. Fetch user info using Access Token từ Google
    const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!googleResponse.ok) {
      throw new Error('Google token invalid or expired');
    }
    
    // Lấy thông tin user từ Google
    const payload = await googleResponse.json();
    const { sub: googleId, email, name, picture } = payload;

    // 2. Tìm User trong Database xem đã tồn tại chưa bằng Email
    let user = await User.findOne({ email });

    if (!user) {
      // Nếu chưa có, Tự động Đăng ký (Tạo User Mới)
      const randomPassword = await bcrypt.hash(Math.random().toString(36).slice(-8) + Date.now().toString(), 10);
      user = new User({
        name: name,
        email: email,
        password: randomPassword, // Generate a random impossible hash
        googleId: googleId,
        isAdmin: false
      });
      await user.save();
      console.log(`[Google Auth]: Created new user for ${email}`);
    } else {
      // Nếu đã có, Cập nhật googleId nếu bị thiếu
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
      console.log(`[Google Auth]: Logged in existing user ${email}`);
    }

    // 3. Tạo Custom Gamestore JWT Token cho frontend
    const gamestoreToken = jwt.sign(
      { userId: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // Trả về giống y hệt lúc login thông thường
    res.json({
      message: "Đăng nhập bằng Google thành công!",
      token: gamestoreToken,
      user: { id: user._id, email: user.email, isAdmin: user.isAdmin, name: user.name, avatar: picture },
    });

  } catch (error) {
    console.error("Lỗi xác thực Google:", error);
    res.status(401).json({ message: "Xác thực Google thất bại. Token không hợp lệ hoặc đã hết hạn." });
  }
});

// POST Forgot Password
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Vui lòng cung cấp email." });
  }
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: "Email không tồn tại." });
    }
    const resetToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );
    // In dev, return token; in prod, send email
    res.json({
      message:
        "Reset token generated (in dev). Use this token to reset password.",
      resetToken: resetToken,
    });
  } catch (error) {
    console.error('❌ Forgot Password Error:', error);
    console.error('❌ Request body:', req.body);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// POST Reset Password
app.post("/api/auth/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ message: "Token và mật khẩu mới là bắt buộc." });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).json({ message: "Token không hợp lệ." });
    }
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();
    res.json({ message: "Mật khẩu đã được thay đổi thành công." });
  } catch (error) {
    console.error("Lỗi reset password:", error);
    if (error.name === "JsonWebTokenError") {
      return res.status(400).json({ message: "Token không hợp lệ." });
    }
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// == Analytics Routes ==

// GET analytics data
app.get("/api/analytics", async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        message: "Database temporarily unavailable. Please try again later." 
      });
    }

    let analytics = await Analytics.findOne();

    if (!analytics) {
      // Tạo analytics document mới nếu chưa có
      analytics = new Analytics();
      await analytics.save();
    }

    // Tính toán thống kê
    const totalSales = analytics.orders.reduce(
      (sum, order) => sum + (order.total || 0),
      0
    );
    const totalOrders = analytics.orders.length;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    // Get all games with viewCount > 0
    const gamesWithViews = await Game.find({ viewCount: { $gt: 0 } })
      .select('_id name viewCount')
      .sort({ viewCount: -1 })
      .limit(20);

    // Top games theo lượt xem (from Game collection)
    const topGamesByViews = gamesWithViews.map(game => ({
      gameId: game._id,
      gameName: game.name,
      views: game.viewCount
    }));

    // Also include games with 0 views from analytics (for backward compatibility)
    const analyticsGameViews = analytics.gameViews || {};
    Object.entries(analyticsGameViews).forEach(([gameId, views]) => {
      if (typeof views === 'number' && views > 0) {
        // Check if already in topGamesByViews
        const existing = topGamesByViews.find(item => item.gameId === gameId);
        if (!existing) {
          // Try to get game name
          Game.findById(gameId).select('name').then(game => {
            if (game) {
              topGamesByViews.push({
                gameId,
                gameName: game.name,
                views
              });
            }
          }).catch(err => console.log('Error finding game:', err));
        }
      }
    });
    
    // Sort by views descending
    topGamesByViews.sort((a, b) => b.views - a.views);

    // Calculate total views from Game collection
    const totalViews = await Game.aggregate([
      { $group: { _id: null, totalViews: { $sum: '$viewCount' } } }
    ]);
    const totalViewCount = totalViews[0]?.totalViews || 0;

    // Top games theo doanh số
    const gameSales = {};
    analytics.orders.forEach((order) => {
      order.items?.forEach((item) => {
        gameSales[item.gameId] = (gameSales[item.gameId] || 0) + item.quantity;
      });
    });

    const topGamesBySales = Object.entries(gameSales)
      .map(([gameId, quantity]) => {
        const game = analytics.games.find((g) => g._id === gameId);
        return {
          gameId,
          gameName: game?.name || `Game ${gameId}`,
          quantity,
        };
      })
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    res.json({
      totalSales,
      totalOrders,
      averageOrderValue,
      topGamesByViews: topGamesByViews.slice(0, 10), // Top 10
      topGamesBySales,
      totalViews: totalViewCount,
      gameViews: analytics.gameViews, // Keep for backward compatibility
      orders: analytics.orders,
      games: analytics.games,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error("Lỗi khi lấy analytics data:", error);
    if (error.name === 'MongooseServerSelectionError' || error.message.includes('buffering timed out')) {
      return res.status(503).json({ 
        message: "Database temporarily unavailable. Please try again later." 
      });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi lấy dữ liệu thống kê." });
  }
});

// POST track game view
app.post("/api/analytics/track-view", async (req, res) => {
  try {
    const { gameId, gameName } = req.body;

    if (!gameId) {
      return res.status(400).json({ message: "Game ID là bắt buộc." });
    }

    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Tăng lượt xem
    analytics.gameViews = analytics.gameViews || {};
    analytics.gameViews[gameId] = (analytics.gameViews[gameId] || 0) + 1;

    // Cập nhật danh sách games nếu có tên mới
    if (gameName) {
      const existingGame = analytics.games.find((g) => g._id === gameId);
      if (!existingGame) {
        analytics.games.push({ _id: gameId, name: gameName });
      }
    }

    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Lượt xem đã được ghi nhận." });
  } catch (error) {
    console.error("Lỗi khi track game view:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận lượt xem." });
  }
});

// POST add order to analytics
app.post("/api/analytics/add-order", async (req, res) => {
  try {
    const orderData = req.body;

    if (!orderData.items || !Array.isArray(orderData.items)) {
      return res
        .status(400)
        .json({ message: "Dữ liệu đơn hàng không hợp lệ." });
    }

    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Thêm đơn hàng mới
    const newOrder = {
      _id: orderData.id || Date.now().toString(), // Use frontend ID or fallback to timestamp
      ...orderData,
      date: new Date(),
      status: "completed",
    };

    analytics.orders.push(newOrder);

    // Cập nhật danh sách games từ đơn hàng
    orderData.items.forEach((item) => {
      if (item.name) {
        const existingGame = analytics.games.find((g) => g._id === item.gameId);
        if (!existingGame) {
          analytics.games.push({ _id: item.gameId, name: item.name });
        }
      }
    });

    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Đơn hàng đã được ghi nhận." });
  } catch (error) {
    console.error("Lỗi khi thêm đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận đơn hàng." });
  }
});

// PUT reset game views (Admin only)
app.put("/api/analytics/reset-views", verifyAdmin, async (req, res) => {
  try {
    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Reset lượt xem nhưng giữ lại đơn hàng và danh sách games
    analytics.gameViews = {};
    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Lượt xem đã được reset." });
  } catch (error) {
    console.error("Lỗi khi reset lượt xem:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi reset lượt xem." });
  }
});

// POST sync analytics data (merge local data with server)
app.post("/api/analytics/sync", async (req, res) => {
  try {
    const gameViews = req.body.gameViews;
    const orders = req.body.orders;
    const games = req.body.games;

    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Merge game views
    if (gameViews) {
      analytics.gameViews = analytics.gameViews || {};
      Object.keys(gameViews).forEach((gameId) => {
        analytics.gameViews[gameId] =
          (analytics.gameViews[gameId] || 0) + gameViews[gameId];
      });
    }

    // Merge orders
    if (orders && Array.isArray(orders)) {
      analytics.orders.push(...orders);
    }

    // Merge games
    if (games && Array.isArray(games)) {
      games.forEach((game) => {
        const existingGame = analytics.games.find((g) => g._id === game._id);
        if (!existingGame) {
          analytics.games.push({ _id: game._id, name: game.name });
        }
      });
    }

    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Dữ liệu đã được đồng bộ." });
  } catch (error) {
    console.error("Lỗi khi sync analytics:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi đồng bộ dữ liệu." });
  }
});

// == Notification Routes ==

// GET user's notifications
app.get("/api/notifications", verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    let query = { user: req.user._id };

    if (unreadOnly === "true") {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Notification.countDocuments(query);

    res.json({
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Lỗi khi lấy notifications:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy thông báo." });
  }
});

// POST mark notification as read
app.put("/api/notifications/:id/read", verifyToken, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Không tìm thấy thông báo." });
    }

    res.json({ message: "Đã đánh dấu đã đọc.", notification });
  } catch (error) {
    console.error("Lỗi khi đánh dấu đã đọc:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// GET notification count (unread)
app.get("/api/notifications/count", verifyToken, async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      read: false,
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error("Lỗi khi lấy số lượng thông báo:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// POST create notification (Admin only)
app.post("/api/notifications", verifyAdmin, async (req, res) => {
  try {
    const {
      userId,
      type,
      title,
      message,
      data,
      priority = "medium",
    } = req.body;

    if (!userId || !type || !title || !message) {
      return res.status(400).json({
        message: "UserId, type, title, và message là bắt buộc.",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy user." });
    }

    const notification = new Notification({
      user: userId,
      type,
      title,
      message,
      data,
      priority,
    });

    await notification.save();

    res.status(201).json({
      message: "Thông báo đã được tạo.",
      notification,
    });
  } catch (error) {
    console.error("Lỗi khi tạo notification:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi tạo thông báo." });
  }
});

// =========================================================

// == Discount Routes (Admin only) ==

// GET all discounts
app.get("/api/discounts", verifyAdmin, async (req, res) => {
  try {
    const discounts = await Discount.find().sort({ createdAt: -1 });
    res.json(discounts);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// GET discount by ID
app.get("/api/discounts/:id", verifyAdmin, async (req, res) => {
  try {
    const discount = await Discount.findById(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: "Không tìm thấy mã giảm giá." });
    }
    res.json(discount);
  } catch (error) {
    console.error("Lỗi khi lấy mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// POST create new discount
app.post("/api/discounts", verifyAdmin, async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    } = req.body;

    // Validate required fields
    if (!name || !code || !type || !value || !startDate || !endDate) {
      return res.status(400).json({
        message: "Name, code, type, value, startDate, và endDate là bắt buộc."
      });
    }

    // Check if discount code already exists
    const existingDiscount = await Discount.findOne({ code: code.toUpperCase() });
    if (existingDiscount) {
      return res.status(400).json({ message: "Mã giảm giá đã tồn tại." });
    }

    // Create new discount
    const discount = new Discount({
      name,
      code: code.toUpperCase(),
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    });

    await discount.save();
    res.status(201).json({
      message: "Mã giảm giá đã được tạo thành công.",
      discount
    });
  } catch (error) {
    console.error("Lỗi khi tạo mã giảm giá:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi tạo mã giảm giá." });
  }
});

// PUT update discount
app.put("/api/discounts/:id", verifyAdmin, async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    } = req.body;

    const discount = await Discount.findById(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: "Không tìm thấy mã giảm giá." });
    }

    // Check if new code conflicts with existing discount (if code is being changed)
    if (code && code !== discount.code) {
      const existingDiscount = await Discount.findOne({ 
        code: code.toUpperCase(),
        _id: { $ne: req.params.id }
      });
      if (existingDiscount) {
        return res.status(400).json({ message: "Mã giảm giá đã tồn tại." });
      }
    }

    // Update discount fields
    const updateData = {
      name,
      code: code ? code.toUpperCase() : discount.code,
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    };

    // Remove undefined fields
    Object.keys(updateData).forEach(key => 
      updateData[key] === undefined && delete updateData[key]
    );

    const updatedDiscount = await Discount.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      message: "Mã giảm giá đã được cập nhật thành công.",
      discount: updatedDiscount
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật mã giảm giá:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật mã giảm giá." });
  }
});

// DELETE discount
app.delete("/api/discounts/:id", verifyAdmin, async (req, res) => {
  try {
    const discount = await Discount.findById(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: "Không tìm thấy mã giảm giá." });
    }

    await Discount.findByIdAndDelete(req.params.id);
    res.json({ message: "Mã giảm giá đã được xóa thành công." });
  } catch (error) {
    console.error("Lỗi khi xóa mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi xóa mã giảm giá." });
  }
});

// POST validate discount code (public endpoint for cart checkout)
app.post("/api/discounts/validate", async (req, res) => {
  try {
    const { code, orderValue } = req.body;

    if (!code) {
      return res.status(400).json({ message: "Mã giảm giá là bắt buộc." });
    }

    const discount = await Discount.findOne({ code: code.toUpperCase() });
    if (!discount) {
      return res.status(404).json({ message: "Mã giảm giá không tồn tại." });
    }

    // Check if discount can be used
    if (!discount.canBeUsed()) {
      return res.status(400).json({ 
        message: "Mã giảm giá không hợp lệ hoặc đã hết hạn." 
      });
    }

    // Check minimum order value
    if (discount.minOrderValue && orderValue < discount.minOrderValue) {
      return res.status(400).json({ 
        message: `Giá trị đơn hàng tối thiểu là $${discount.minOrderValue}.` 
      });
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (discount.type === 'percentage') {
      discountAmount = orderValue * (discount.value / 100);
      // Apply max discount amount limit if set
      if (discount.maxDiscountAmount && discountAmount > discount.maxDiscountAmount) {
        discountAmount = discount.maxDiscountAmount;
      }
    } else {
      discountAmount = discount.value;
    }

    const finalAmount = Math.max(0, orderValue - discountAmount);

    res.json({
      valid: true,
      discount: {
        id: discount._id,
        name: discount.name,
        code: discount.code,
        type: discount.type,
        value: discount.value,
        discountAmount,
        finalAmount
      }
    });
  } catch (error) {
    console.error("Lỗi khi xác thực mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi xác thực mã giảm giá." });
  }
});

// =========================================================

// --- Global Error Handling Middleware ---
app.use((err, req, res, next) => {
  console.error("🔥 [Global Error]:", err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Lỗi máy chủ nội bộ. Vui lòng thử lại sau.",
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
});

// --- Start Server ---
const server = app.listen(PORT, () => {
  console.log(`API Server đang chạy tại http://localhost:${PORT}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    mongoose.connection.close();
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    mongoose.connection.close();
  });
});
