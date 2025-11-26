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
const bcrypt = require("bcryptjs"); // For password hashing
const jwt = require("jsonwebtoken"); // For authentication tokens

// --- Initialize Cache ---
const myCache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // Cache for 5 minutes

// --- Initialize Google AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Use the correct model name
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

const app = express();
const PORT = process.env.PORT || 4000;

// --- Middlewares ---
console.log(">>> SERVER: Setting up middleware...");
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://my-ecommerce-app-red.vercel.app',
    'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app',
    'https://my-ecommerce-ijvt7e7kl-swagducks-projects.vercel.app',
    'https://my-ecommerce-ahkdafcwc-swagducks-projects.vercel.app',
    'https://my-ecommerce-1cgddc1zl-swagducks-projects.vercel.app',
    'https://my-ecommerce-j53i8rvb3-swagducks-projects.vercel.app',
    'https://my-ecommerce-mwav2gsgx-swagducks-projects.vercel.app',
    'https://my-ecommerce-qxf9s05no-swagducks-projects.vercel.app',
    'https://my-ecommerce-bm4zando6-swagducks-projects.vercel.app',
    'https://my-ecommerce-l6qx27hyb-swagducks-projects.vercel.app',
    'https://my-ecommerce-3zubgbbde-swagducks-projects.vercel.app',
    'https://my-ecommerce-3rku918l9-swagducks-projects.vercel.app',
    'https://my-ecommerce-mdzgyhhog-swagducks-projects.vercel.app'
  ],
  credentials: true
}));
console.log(">>> SERVER: CORS middleware applied with specific origins.");
app.use(express.json());
console.log(">>> SERVER: JSON middleware applied.");

// --- Connect to Database ---
console.log(">>> SERVER: Attempting DB connection...");
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Kết nối MongoDB Atlas thành công!");
  })
  .catch((err) => console.error("Lỗi kết nối MongoDB:", err));

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
    req.user = { _id: decoded.userId }; // Gắn ID người dùng vào request
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

// == Game Routes (CORRECT ORDER) ==

// 1. GET All Games (with sorting, filtering, and pagination)
app.get("/api/games", async (req, res) => {
  try {
    const { limit, sort, order = "desc" } = req.query;

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
    res.json(games);
  } catch (err) {
    console.log("Lỗi server /api/games:", err.message);
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

// 3. GET Search Games - Moved UP (Using simplified regex for now)
app.get("/api/games/search", async (req, res) => {
  console.log(">>> SEARCH ROUTE HIT <<<");
  try {
    const query = req.query.q;
    console.log(`Search query received: "${query}"`);

    if (!query) {
      console.log("Search query is missing!");
      return res.status(400).json({ message: "Search query is required" });
    }

    console.log(`Attempting SIMPLE MongoDB find for: "${query}"`);

    // Switched back to $text search (requires text index)
    console.log(`Attempting MongoDB $text search for: "${query}"`);
    const games = await Game.find(
      { $text: { $search: query } },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(10);

    console.log(`MongoDB find completed. Found ${games.length} games.`);
    res.json(games);
  } catch (error) {
    console.error("!!! DETAILED SEARCH ERROR:", error);
    if (error.message && error.message.includes("text index required")) {
      return res.status(500).json({
        message:
          "Lỗi server: Cần tạo text index trong MongoDB (trên 'name' và 'description') để dùng $text search.",
      });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi tìm kiếm game." });
  }
});

// == Review Routes ==

// GET all reviews for a game
app.get("/api/games/:id/reviews", async (req, res) => {
  try {
    const reviews = await Review.find({ game: req.params.id })
      .populate("user", "email")
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    console.error("Lỗi khi lấy đánh giá:", error);
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

    const alreadyReviewed = await Review.findOne({
      game: gameId,
      user: userId,
    });
    if (alreadyReviewed) {
      return res.status(400).json({ message: "Bạn đã đánh giá game này rồi." });
    }

    const review = new Review({
      game: gameId,
      user: userId,
      rating: Number(rating),
      comment,
    });

    await review.save();

    // Update game's rating and numReviews
    const reviews = await Review.find({ game: gameId });
    game.numReviews = reviews.length;
    game.rating =
      reviews.reduce((acc, item) => item.rating + acc, 0) / reviews.length;

    await game.save();

    res.status(201).json({ message: "Cảm ơn bạn đã đánh giá!" });
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
app.post("/api/test-payment", async (req, res) => {
  try {
    const { cartItems } = req.body;
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
    
    res.json({
      success: true,
      items: processedItems,
      totalAmount: total,
      message: "Test payment successful"
    });
  } catch (error) {
    console.error('Test payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// == Stripe Checkout Route ==
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { cartItems } = req.body;
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
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("/")) {
        console.warn(
          `Invalid image URL for ${item.name}: ${imageUrl}. Using placeholder.`
        );
        // Provide a fallback placeholder image URL if needed
        imageUrl = "https://via.placeholder.com/80x80?text=No+Image";
      } else {
        imageUrl = `http://localhost:5173${imageUrl}`; // Prepend base URL
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
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      success_url: process.env.FRONTEND_URL + "/success?session_id={CHECKOUT_SESSION_ID}", // Your success page URL
      cancel_url: process.env.FRONTEND_URL + "/cancel", // Your cancel page URL
      metadata: {
        userId: req.user?.id || 'guest' // Include user ID in metadata
      },
      client_reference_id: req.user?.id || 'guest' // Alternative way to track user
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
      return res.json(existingOrder); // Return existing order
    }
    
    // Calculate total and prepare order items
    let totalAmount = 0;
    const orderItems = cartItems.map(item => {
      let finalPrice = item.price;
      
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
        image: item.image,
        discountType: item.discountType || 'none',
        discountValue: item.discountValue || 0,
        finalPrice: finalPrice
      };
    });
    
    // Create order
    const order = new Order({
      user: userId,
      items: orderItems,
      totalAmount,
      paymentMethod: 'stripe',
      paymentId: sessionId,
      status: 'completed'
    });
    
    await order.save();
    
    // Populate game details for response
    await order.populate('items.game', 'name genre image rating');
    
    console.log(`✅ Order created from frontend: ${order._id} for user ${userId}`);
    
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
        // Create order from completed session
        const orderData = {
          items: session.display_items || [],
          totalAmount: session.amount_total / 100, // Convert from cents
          paymentMethod: "stripe",
          paymentId: session.id,
          status: "completed"
        };

        // Get user from session metadata or create guest order
        const userId = session.metadata?.userId;
        if (userId) {
          orderData.user = userId;
          
          const order = new Order(orderData);
          await order.save();
          
          console.log(`✅ Order created for user ${userId}: ${order._id}`);
        }
      } catch (error) {
        console.error("Error creating order from webhook:", error);
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

// == Chatbot Route ==
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    console.log('🤖 Chat API Request:', { message, historyLength: history?.length });
    console.log('🤖 History sample:', history?.slice(0, 2));
    const systemPrompt = `
      Bạn là "Trợ lý AI Gam34Pers", một chatbot bán hàng vui vẻ và hữu ích.
      Nhiệm vụ của bạn là phân tích yêu cầu của người dùng và CHỈ trả lời bằng một đối tượng JSON.
      KHÔNG được trả lời bằng văn bản thông thường.
      
      Các thể loại (genre) bạn biết: Nhập vai, Hành động, Phiêu lưu, Mô phỏng, Indie, Simulation, RPG, Chiến thuật, Lén lút, Quản lý, Bắn súng, Fantasy, Hợp tác, Khoa học viễn tưởng, Metroidvania, Sinh tồn, Xây dựng, Chặt chém, Thế giới mở, Steam Offline, eSports, Kinh dị, Tâm lý, Samurai, Thử thách cao, Souls-like, Góc nhìn thứ nhất, Chuyện kể, Giải đố, Đua xe, Thể thao, Chiến lược thời gian thực.
      Các nền tảng (platform) bạn biết: PC, PlayStation 5, Xbox Series X, Nintendo Switch, PS4, Xbox One.

      *** HƯỚNG DẪN MỚI: ***
      - Nếu người dùng hỏi về MỘT TÊN GAME CỤ THỂ (ví dụ: "có Cyberpunk không?", "Elden Ring", "tìm God of War"), HÃY ƯU TIÊN tìm chính xác game đó. Trả về JSON với query CHỈ chứa tên game đó (dùng regex để tìm không phân biệt hoa thường).
        Ví dụ User: "có cyberpunk 2077 không?" -> JSON: { "response": "Có ngay Cyberpunk 2077 cho bạn:", "query": { "name": { "$regex": "Cyberpunk 2077", "$options": "i" } } }
      - Nếu người dùng chỉ hỏi THỂ LOẠI hoặc NỀN TẢNG (ví dụ: "game nhập vai", "game cho PC"), HÃY tìm theo các tiêu chí đó như bình thường.
      - LUÔN LUÔN cố gắng trả về một đối tượng "query" nếu bạn nghĩ người dùng muốn tìm game. Nếu không chắc, trả về query rỗng {}.
      - Ưu tiên sử dụng thông tin từ LỊCH SỬ (history) để hiểu ngữ cảnh của câu hỏi hiện tại.
      *** KẾT THÚC HƯỚNG DẪN MỚI ***

      Ví dụ:
      User: "Xin chào"
      JSON: { "response": "Xin chào! Tôi có thể giúp bạn tìm game không?", "query": {} }

      User: "Tìm cho tôi vài game nhập vai"
      JSON: { "response": "OK, tôi đã tìm thấy một số game 'Nhập vai' cho bạn:", "query": { "genre": "Nhập vai" } }
      
      User: "có elden ring không?" // Hướng dẫn mới
      JSON: { "response": "Chắc chắn rồi, Elden Ring đây:", "query": { "name": { "$regex": "Elden Ring", "$options": "i" } } }

      User: "game hành động trên PC"
      JSON: { "response": "Tuyệt! Dưới đây là các game 'Hành động' cho 'PC':", "query": { "genre": "Hành động", "platform": "PC" } }
      
      User: "Cảm ơn"
      JSON: { "response": "Không có gì! Chúc bạn chơi game vui vẻ!", "query": {} }

      Nếu tôi hỏi ngoài chủ đề game, hãy từ chối:
      User: "thủ đô của Việt Nam là gì"
      JSON: { "response": "Rất tiếc, tôi chỉ là trợ lý Gam34Pers và chỉ có thể giúp bạn về game thôi.", "query": {} }
    `;
    console.log('🤖 Initializing Gemini AI...');
    if (!process.env.GEMINI_API_KEY) {
      console.error('❌ GEMINI_API_KEY not found in environment');
      return res.status(500).json({ text: "AI service not configured properly" });
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    console.log('🤖 Gemini AI initialized successfully');
    
    const formattedHistory = history
      .filter((msg) => msg.id !== 1)
      .map((msg) => ({
        role: msg.from === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }))
      .filter((msg, index, arr) => {
        // Remove any bot messages that come before user messages
        if (msg.role !== "user") {
          // Keep bot messages only if there's a user message before them
          const hasUserBefore = arr.slice(0, index).some(m => m.role === "user");
          return hasUserBefore;
        }
        return true;
      })
      .filter((msg, index, arr) => {
        // Ensure first message is from user
        if (index === 0 && msg.role !== "user") return false;
        return true;
      });
    const chat = model.startChat({
      history: formattedHistory,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    });
    console.log('🤖 Sending message to Gemini:', message);
    const result = await chat.sendMessage(message);
    const aiResponseText = result.response.text();
    console.log('🤖 Gemini raw response:', aiResponseText);
    let aiJson;
    try {
      const cleanedJsonText = aiResponseText
        .replace(/```json\n|```/g, "")
        .trim();
      aiJson = JSON.parse(cleanedJsonText);
    } catch (e) {
      console.error("Lỗi parse JSON từ AI:", aiResponseText);
      console.log("🤖 AI returned non-JSON response, using as plain text...");
      
      // If AI returns plain text, use it directly as the response
      const fallbackResponse = {
        response: aiResponseText.trim(),
        query: {}
      };
      return res.json({
        text: fallbackResponse.response,
        results: [],
      });
    }
    let gameResults = [];
    if (
      aiJson.query &&
      (aiJson.query.genre || aiJson.query.platform || aiJson.query.name)
    ) {
      gameResults = await Game.find(aiJson.query).limit(5);
    }
    res.json({
      text: aiJson.response,
      results: gameResults,
    });
  } catch (error) {
    console.error('❌ Chat API Error:', error);
    console.error('❌ Request body:', req.body);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      text: "Rất tiếc, bộ não AI của tôi đang tạm nghỉ. Lỗi: " + error.message,
    });
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
      items,
      totalAmount,
      paymentMethod,
      paymentId,
      status
    });
    
    await order.save();
    
    // Populate game details for response
    await order.populate('items.game', 'name genre image rating');
    
    // Update analytics
    await Analytics.findOneAndUpdate(
      {},
      {
        $push: {
          orders: {
            userId,
            items: items.map(item => ({
              gameId: item.game,
              name: item.name,
              quantity: item.quantity,
              price: item.finalPrice || item.price
            })),
            total: totalAmount,
            createdAt: new Date()
          }
        }
      },
      { upsert: true }
    );
    
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

// GET all users
app.get("/api/users", verifyAdmin, async (req, res) => {
  try {
    const users = await User.find({}, "-password"); // Lấy tất cả user, bỏ trường password
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

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`API Server đang chạy tại http://localhost:${PORT}`);
});
