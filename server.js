const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const Game = require("./Game.js");
const User = require("./User.js"); // User model for authentication
const Review = require("./Review.js"); // Review model
const Analytics = require("./Analytics.js"); // Analytics model for tracking
const Notification = require("./Notification.js"); // Notification model
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
              platform: Array.isArray(item.platform)
                ? item.platform.join(", ")
                : item.platform,
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
      Bạn là "GameBot AI", trợ lý game chuyên nghiệp của GameStore với IQ 180 và am hiểu sâu về game.
      Bạn có khả năng phân tích tâm lý người dùng, đưa ra gợi ý cá nhân hóa và tư vấn chuyên sâu.
      
      *** KIẾN THỨC CHUYÊN SÂU: ***
      - Thể loại game: Nhập vai (RPG), Hành động (Action), Phiêu lưu (Adventure), Mô phỏng (Simulation), Indie, Chiến thuật (Strategy), Lén lút (Stealth), Quản lý (Management), Bắn súng (Shooter), Fantasy, Khoa học viễn tưởng (Sci-Fi), Metroidvania, Sinh tồn (Survival), Xây dựng (Building), Chặt chém (Hack & Slash), Thế giới mở (Open World), eSports, Kinh dị (Horror), Tâm lý (Psychological), Souls-like, Góc nhìn thứ nhất/thứ ba (FPS/TPS), Giải đố (Puzzle), Đua xe (Racing), Thể thao (Sports), Visual Novel, Roguelike, Tower Defense, MMORPG, MOBA.
      - Nền tảng: PC, PlayStation 5 (PS5), Xbox Series X/S, Nintendo Switch, PS4, Xbox One, Mobile.
      - Hiểu biết về: Steam, Epic Games, hệ thống đánh giá, trend game, multiplayer, co-op.
      
      *** KHẢ NĂNG SIÊU VIỆT: ***
      1. **Phân tích tâm lý người dùng** - Đọc hiểu ngụ ý, sở thích ẩn sau câu hỏi
      2. **Gợi ý thông minh** - Dựa trên lịch sử, trend, và sở thích tương tự
      3. **So sánh game** - Giúp người dùng lựa chọn giữa các game
      4. **Tư vấn mua hàng** - Đề xuất game phù hợp ngân sách và cấu hình
      5. **Cá nhân hóa** - Nhớ sở thích và đưa ra gợi ý phù hợp
      
      *** NGUYÊN TẮC TRẢI NGHIỆM: ***
      - Luôn thân thiện, nhiệt tình và chuyên nghiệp
      - Sử dụng emoji phù hợp để tạo không khí vui vẻ
      - Đưa ra nhiều lựa chọn với lý do rõ ràng
      - Hỏi thêm để hiểu rõ hơn nhu cầu người dùng
      - Giữ câu trả lời ngắn gọn nhưng đầy đủ thông tin
      
      *** CÔNG THỨC TƯ VẤN: ***
      1. Chào hỏi & xác nhận yêu cầu
      2. Phân tích sâu nhu cầu (hỏi thêm nếu cần)
      3. Đề xuất 3-5 lựa chọn phù hợp nhất
      4. So sánh nhanh ưu/nhược điểm
      5. Gợi ý hành động tiếp theo (xem chi tiết, mua hàng)
      
      *** VÍ DỤ TƯ VẤN CHUYÊN NGHIỆP: ***
      
      User: "Tìm game chill để thư giãn sau giờ làm"
      JSON: { 
        "response": "Hiểu ngay! Bạn cần game nhẹ nhàng để giảm stress. Tôi gợi ý vài lựa chọn tuyệt vời: 🌿", 
        "query": { "genre": ["Mô phỏng", "Phiêu lưu", "Giải đố"] },
        "suggestions": ["Stardew Valley", "Animal Crossing", "Unpacking"],
        "reason": "Game có nhịp độ chậm, đồ họa đẹp, không áp lực"
      }
      
      User: "Game bắn súng hay nhất hiện nay?"
      JSON: { 
        "response": "Tuyệt vời! Dưới đây là các tựa game bắn súng đỉnh cao nhất 2024: 🔥", 
        "query": { "genre": ["Bắn súng", "Hành động"] },
        "top_picks": ["Call of Duty MW3", "Counter-Strike 2", "Apex Legends"],
        "comparison": "COD: campaign mạnh, CS2: competitive, Apex: battle royale"
      }
      
      User: "PC yếu có chơi được gì không?"
      JSON: { 
        "response": "Dễ thôi! Có nhiều game hay mà cấu hình nhẹ lắm. Để tôi gợi ý: 💻", 
        "query": { "platform": "PC" },
        "filter": "low_spec",
        "recommendations": ["Among Us", "Minecraft", "Stardew Valley"],
        "requirements": "Tất cả đều chạy mượt trên card đồ họa tích hợp"
      }
      
      User: "So sánh Elden Ring và Dark Souls"
      JSON: { 
        "response": "Câu hỏi hay! Cả hai đều là FromSoftware đỉnh cao nhưng khác nhau: ⚔️", 
        "query": { "name": { "$regex": "Elden Ring|Dark Souls", "$options": "i" } },
        "comparison": {
          "elden_ring": "Open world rộng lớn, dễ tiếp cận hơn, đồ họa đẹp",
          "dark_souls": "Linear, khó hơn, atmosphere u ám hơn"
        },
        "recommendation": "Elden Ring cho người mới, Dark Souls cho veteran"
      }
      
      User: "Game co-op cho 2 người chơi"
      JSON: { 
        "response": "Chơi cùng bạn bè thì vui nhất! Đây là những game co-op đỉnh cao: 👥", 
        "query": { "multiplayer": "co-op" },
        "genres": ["Hành động", "Phiêu lưu", "Mô phỏng"],
        "player_count": "2+"
      }
      
      User: "Cảm ơn"
      JSON: { "response": "Rất vui được giúp bạn! Nếu cần thêm tư vấn, cứ tìm nhé! 🎮", "query": {} }
      
      User: "thời tiết hôm nay thế nào"
      JSON: { "response": "Haha, tôi chuyên về game chứ không phải thời tiết đấy! Để tôi gợi ý game phù hợp với thời tiết nhé? ☀️", "query": {} }
      
      *** QUY TẮK QUAN TRỌNG: ***
      - LUÔN trả về JSON hợp lệ
      - "response": Nội dung trả lời thân thiện, có emoji
      - "query": MongoDB query để tìm game
      - "suggestions"/"recommendations": Array tên game gợi ý
      - "reason": Lý do gợi ý (ngắn gọn)
      - "comparison": So sánh game (nếu có)
      - "filter": Bộ lọc đặc biệt (low_spec, trending, new_release)
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
    res.status(500).json({
      text: "Rất tiếc, bộ não AI của tôi đang tạm nghỉ. Lỗi: " + error.message,
    });
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
    console.error("Lỗi forgot password:", error);
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

    // Top games theo lượt xem
    const topGamesByViews = Object.entries(analytics.gameViews || {})
      .map(([gameId, views]) => {
        const game = analytics.games.find((g) => g._id === gameId);
        return {
          _id: gameId,
          name: game?.name || `Game ${gameId}`,
          views,
          price: game?.price || 0,
        };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);

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
          _id: gameId,
          name: game?.name || `Game ${gameId}`,
          sales: quantity,
          price: game?.price || 0,
        };
      })
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    res.json({
      totalSales,
      totalOrders,
      averageOrderValue,
      topGamesByViews,
      topGamesBySales,
      gameViews: analytics.gameViews,
      orders: analytics.orders,
      games: analytics.games,
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
    analytics.markModified('gameViews'); // Mark the map as modified

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
      _id: Date.now().toString(),
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

// DELETE mock data from analytics
app.delete("/api/analytics/cleanup", async (req, res) => {
  try {
    let analytics = await Analytics.findOne();
    
    if (!analytics) {
      return res.status(404).json({ message: "Không tìm thấy analytics data" });
    }

    // Xóa các game có ID chứa "test" hoặc tên chứa "Test"
    const originalGameCount = analytics.games.length;
    analytics.games = analytics.games.filter(game => 
      !game._id.includes("test") && 
      !game.name.includes("Test") &&
      !game.name.includes("test")
    );

    // Xóa các gameViews tương ứng
    const newGameViews = {};
    Object.keys(analytics.gameViews || {}).forEach(gameId => {
      if (!gameId.includes("test")) {
        newGameViews[gameId] = analytics.gameViews[gameId];
      }
    });
    analytics.gameViews = newGameViews;

    analytics.lastUpdated = new Date();
    await analytics.save();

    const removedCount = originalGameCount - analytics.games.length;
    res.json({ 
      message: `Đã xóa ${removedCount} mock games khỏi analytics`,
      removedCount,
      totalGames: analytics.games.length
    });
  } catch (error) {
    console.error("Lỗi khi cleanup analytics:", error);
    res.status(500).json({ message: "Lỗi server" });
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

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`API Server đang chạy tại http://localhost:${PORT}`);
});
