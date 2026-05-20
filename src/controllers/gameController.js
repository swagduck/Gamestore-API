const mongoose = require("mongoose");
const Game = require("../models/Game");
const NodeCache = require("node-cache");
const { cloudinary } = require("../utils/cloudinary");
const redisClient = require("../utils/redisClient");
const myCache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

const getAllGames = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "Database temporarily unavailable." });
    }
    const { limit, sort } = req.query;
    // createdAt luôn sắp xếp mới nhất trước (desc), rating cũng desc
    const order = sort === 'createdAt' || sort === 'rating' || sort === '_id' ? 'desc' : (req.query.order || 'desc');
    const cacheKey = `games_${limit || 'all'}_${sort || 'none'}_${order}`;
    
    if (redisClient && redisClient.isOpen) {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) return res.json(JSON.parse(cachedData));
    } else {
      const cachedData = myCache.get(cacheKey);
      if (cachedData) return res.json(cachedData);
    }

    let query = Game.find();
    if (sort) {
      const sortOptions = {};
      sortOptions[sort] = order === 'desc' ? -1 : 1;
      query = query.sort(sortOptions);
    }
    if (limit) query = query.limit(parseInt(limit, 10));

    const games = await query.exec();
    
    if (redisClient && redisClient.isOpen) {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(games));
    } else {
      myCache.set(cacheKey, games);
    }
    
    res.json(games);
  } catch (err) {
    if (err.name === 'MongooseServerSelectionError') {
      return res.status(503).json({ message: "Database temporarily unavailable." });
    }
    res.status(500).json({ message: err.message });
  }
};

const findGamesForChatbot = async (req, res) => {
  try {
    const { genre, platform } = req.query;
    let query = {};
    if (genre) query.genre = { $in: [genre] };
    if (platform) query.platform = { $in: [platform] };
    const games = await Game.find(query).limit(5);
    res.json(games);
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const searchGames = async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ message: "Search query is required" });
    const games = await Game.find({ $text: { $search: query } })
      .sort({ score: { $meta: "textScore" } })
      .limit(10);
    res.json(games);
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ khi tìm kiếm game." });
  }
};

const getDiscountedGames = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "Database temporarily unavailable." });
    }
    const now = new Date();
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
    res.json(games);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getGameById = async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ message: "Không tìm thấy game" });
    res.json(game);
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID game không hợp lệ." });
    res.status(500).json({ message: err.message });
  }
};

const trackGameView = async (req, res) => {
  try {
    const game = await Game.findByIdAndUpdate(req.params.id, { $inc: { viewCount: 1 } }, { new: true });
    if (!game) return res.status(404).json({ message: "Game không tồn tại." });
    res.json({ message: "Lượt xem đã được ghi nhận.", viewCount: game.viewCount, gameName: game.name });
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận lượt xem." });
  }
};

const addGame = async (req, res) => {
  try {
    const game = new Game(req.body);
    await game.save();
    // Xóa cache để game mới hiển thị ngay trên trang chủ
    myCache.flushAll();
    if (redisClient && redisClient.isOpen) {
      const keys = await redisClient.keys('games_*');
      if (keys.length) await redisClient.del(keys);
    }
    res.status(201).json(game);
  } catch (err) {
    if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
};

const updateGame = async (req, res) => {
  try {
    const oldGame = await Game.findById(req.params.id);
    if (!oldGame) return res.status(404).json({ message: "Không tìm thấy game để cập nhật" });
    
    if (req.body.image && req.body.image !== oldGame.image) {
      if (oldGame.image && oldGame.image.includes('cloudinary.com') && oldGame.image.includes('/gamestore_avatars/')) {
        try {
          const publicId = 'gamestore_avatars/' + oldGame.image.split('/gamestore_avatars/')[1].split('.')[0];
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.error('Error deleting old image on Cloudinary:', err);
        }
      }
    }

    const updatedGame = await Game.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    // Xóa cache để thay đổi hiển thị ngay
    myCache.flushAll();
    if (redisClient && redisClient.isOpen) {
      const keys = await redisClient.keys('games_*');
      if (keys.length) await redisClient.del(keys);
    }
    res.json(updatedGame);
  } catch (err) {
    if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
    if (err.name === "CastError") return res.status(400).json({ message: "ID game không hợp lệ." });
    res.status(500).json({ message: err.message });
  }
};

const deleteGame = async (req, res) => {
  try {
    const deletedGame = await Game.findByIdAndDelete(req.params.id);
    if (!deletedGame) return res.status(404).json({ message: "Không tìm thấy game để xóa" });
    
    if (deletedGame.image && deletedGame.image.includes('cloudinary.com') && deletedGame.image.includes('/gamestore_avatars/')) {
      try {
        const publicId = 'gamestore_avatars/' + deletedGame.image.split('/gamestore_avatars/')[1].split('.')[0];
        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.error('Error deleting image on Cloudinary:', err);
      }
    }
    // Xóa cache
    myCache.flushAll();
    if (redisClient && redisClient.isOpen) {
      const keys = await redisClient.keys('games_*');
      if (keys.length) await redisClient.del(keys);
    }
    res.json({ message: "Đã xóa game thành công" });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID game không hợp lệ." });
    res.status(500).json({ message: err.message });
  }
};

const { GoogleGenerativeAI } = require('@google/generative-ai');

const getRecommendations = async (req, res) => {
  try {
    const { cartItems } = req.body;
    if (!cartItems || cartItems.length === 0) {
      return res.json([]);
    }
    const currentIds = cartItems.map((item) => item._id);
    const currentGenres = [...new Set(cartItems.flatMap((item) => item.genre))];
    
    if (!process.env.GEMINI_API_KEY) {
      const recommendations = await Game.find({
        genre: { $in: currentGenres },
        _id: { $nin: currentIds },
      }).limit(5).lean();
      return res.json(recommendations);
    }

    const candidates = await Game.find({ _id: { $nin: currentIds } }).limit(20).lean();
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const prompt = `You are a game recommendation AI for Gamestore. 
    The user has these games in their cart/history: ${cartItems.map(g => g.name + ' (' + g.genre + ')').join(', ')}.
    Available candidate games: ${candidates.map(g => g._id + ': ' + g.name + ' (' + g.genre + ')').join(' | ')}.
    Select exactly 5 best candidate games for this user based on their genres. 
    For each selected game, write a short 1-sentence reasoning (in Vietnamese) why they would like it.
    Return ONLY a raw JSON array (no markdown block) of objects with 2 fields: 
    "id" (the game _id) and "aiReasoning" (the reason).`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
      }
    });
    const result = await model.generateContent(prompt);
    const aiText = result.response.text();
    const aiResult = JSON.parse(aiText);

    const recommendedGames = [];
    for (let aiObj of aiResult) {
      const game = candidates.find(c => c._id.toString() === aiObj.id);
      if (game) {
        game.aiReasoning = aiObj.aiReasoning;
        recommendedGames.push(game);
      }
    }
    
    if (recommendedGames.length === 0) {
       const fallback = await Game.find({ genre: { $in: currentGenres }, _id: { $nin: currentIds } }).limit(5).lean();
       return res.json(fallback);
    }
    
    res.json(recommendedGames);
  } catch (error) {
    console.error("Lỗi khi tạo đề xuất:", error);
    // Lỗi gọi Gemini thì trả fallback
    try {
      const { cartItems } = req.body;
      const currentIds = cartItems.map((item) => item._id);
      const currentGenres = [...new Set(cartItems.flatMap((item) => item.genre))];
      const fallback = await Game.find({ genre: { $in: currentGenres }, _id: { $nin: currentIds } }).limit(5).lean();
      return res.json(fallback);
    } catch (fallbackError) {
      res.status(500).json({ message: "Không thể tạo đề xuất" });
    }
  }
};

module.exports = {
  getAllGames,
  findGamesForChatbot,
  searchGames,
  getDiscountedGames,
  getGameById,
  trackGameView,
  addGame,
  updateGame,
  deleteGame,
  getRecommendations
};
