const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const Game = require("./Game.js");
const User = require("./User.js"); // User model for authentication
const Review = require("./Review.js"); // Review model
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { GoogleGenerativeAI } = require("@google/generative-ai");
const NodeCache = require("node-cache");
const bcrypt = require("bcryptjs"); // For password hashing
const jwt = require("jsonwebtoken"); // For authentication tokens

// --- Initialize Cache ---
const myCache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // Cache for 5 minutes

// --- Initialize Google AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Use the model name that worked for you (e.g., "gemini-flash-latest")
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

const app = express();
const PORT = process.env.PORT || 4000;

// --- Middlewares ---
console.log(">>> SERVER: Setting up middleware...");
app.use(cors());
console.log(">>> SERVER: CORS middleware applied.");
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
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Không có token, không được phép truy cập' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { _id: decoded.userId }; // Gắn ID người dùng vào request
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Không có token, không được phép truy cập' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Yêu cầu quyền admin' });
    }

    req.user = user; // Gắn thông tin user vào request
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

// --- API ROUTES ---
console.log(">>> SERVER: Defining API routes...");

// == Game Routes (CORRECT ORDER) ==

// 1. GET All Games (with sorting, filtering, and pagination)
app.get("/api/games", async (req, res) => {
  try {
    const { limit, sort, order = 'desc' } = req.query;

    let query = Game.find();

    if (sort) {
      const sortOptions = {};
      sortOptions[sort] = order === 'desc' ? -1 : 1;
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
    ).sort(
      { score: { $meta: "textScore" } }
    ).limit(10);

    console.log(`MongoDB find completed. Found ${games.length} games.`);
    res.json(games);
  } catch (error) {
    console.error("!!! DETAILED SEARCH ERROR:", error);
    if (error.message && error.message.includes("text index required")) {
      return res
        .status(500)
        .json({
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
    const reviews = await Review.find({ game: req.params.id }).populate('user', 'email').sort({ createdAt: -1 });
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

    const alreadyReviewed = await Review.findOne({ game: gameId, user: userId });
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
    game.rating = reviews.reduce((acc, item) => item.rating + acc, 0) / reviews.length;

    await game.save();
    
    myCache.del("allGames"); // Invalidate cache

    res.status(201).json({ message: "Cảm ơn bạn đã đánh giá!" });

  } catch (error) {
    console.error("Lỗi khi thêm đánh giá:", error);
    if (error.name === 'ValidationError') {
        return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi thêm đánh giá." });
  }
});

// 4. GET Single Game by ID - Moved LAST among GETs
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
    myCache.del("allGames"); // Invalidate cache
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
    myCache.del("allGames"); // Invalidate cache
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
    myCache.del("allGames"); // Invalidate cache
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
    const currentGenres = [...new Set(cartItems.flatMap(item => item.genre))];
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

// == Stripe Checkout Route ==
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { cartItems } = req.body;
    const line_items = cartItems.map((item) => {
      // Basic validation for image URL
      let imageUrl = item.image;
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("/")) {
        console.warn(
          `Invalid image URL for ${item.name}: ${imageUrl}. Using placeholder.`
        );
        // Provide a fallback placeholder image URL if needed
        imageUrl = "https://via.placeholder.com/80x80?text=No+Image";
      } else {
        imageUrl = `http://localhost:5173${item.image}`; // Prepend base URL
      }

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            images: [imageUrl], // Must be an array of absolute URLs
            metadata: {
              platform: Array.isArray(item.platform) ? item.platform.join(', ') : item.platform,
              id: item._id,
            },
          },
          unit_amount: Math.round(item.price * 100), // Price in cents
        },
        quantity: item.quantity,
      };
    });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      success_url: "http://localhost:5173/success", // Your success page URL
      cancel_url: "http://localhost:5173/cancel", // Your cancel page URL
    });
    res.json({ url: session.url }); // Return the checkout session URL
  } catch (error) {
    console.error("Lỗi khi tạo phiên Stripe:", error);
    res.status(500).json({ message: "Không thể tạo phiên thanh toán" });
  }
});

// == Chatbot Route ==
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    const systemPrompt = `
      Bạn là "Trợ lý AI GameStore", một chatbot bán hàng vui vẻ và hữu ích.
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
      JSON: { "response": "Rất tiếc, tôi chỉ là trợ lý GameStore và chỉ có thể giúp bạn về game thôi.", "query": {} }
    `;
    const formattedHistory = history
      .filter((msg) => msg.id !== 1)
      .map((msg) => ({
        role: msg.from === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }));
    const chat = model.startChat({
      history: formattedHistory,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
        role: "model",
      },
    });
    const result = await chat.sendMessage(message);
    const aiResponseText = result.response.text();
    let aiJson;
    try {
      const cleanedJsonText = aiResponseText
        .replace(/```json\n|```/g, "")
        .trim();
      aiJson = JSON.parse(cleanedJsonText);
    } catch (e) {
      console.error("Lỗi parse JSON từ AI:", aiResponseText);
      return res.status(500).json({ text: "AI trả về lỗi, vui lòng thử lại." });
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
    console.error("Lỗi API Chat:", error);
    res
      .status(500)
      .json({
        text:
          "Rất tiếc, bộ não AI của tôi đang tạm nghỉ. Lỗi: " + error.message,
      });
  }
});

// == User Management Routes (Admin Only) ==

// GET all users
app.get("/api/users", verifyAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password'); // Lấy tất cả user, bỏ trường password
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
        return res.status(400).json({ message: "Không thể tự tước quyền admin của chính mình." });
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
    });
    const savedUser = await newUser.save();
    const token = jwt.sign(
      { userId: savedUser._id, email: savedUser.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.status(201).json({
      message: "Đăng ký thành công!",
      token: token,
      user: { id: savedUser._id, email: savedUser.email },
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

// ===== GENERIC ERROR HANDLER (MUST BE LAST, BEFORE LISTEN) =====
app.use((err, req, res, next) => {
  console.error("!!! UNHANDLED ERROR DETECTED:", err.stack || err); // Log the detailed error stack
  res.status(500).send("Something broke on the server!"); // Send generic 500 response
});
// =========================================================

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`API Server đang chạy tại http://localhost:${PORT}`);
});
