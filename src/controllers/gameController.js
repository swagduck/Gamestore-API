const mongoose = require("mongoose");
const Game = require("../models/Game");
const NodeCache = require("node-cache");
const myCache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

const getAllGames = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "Database temporarily unavailable." });
    }
    const { limit, sort, order = "desc" } = req.query;
    const cacheKey = `games_${limit || 'all'}_${sort || 'none'}_${order}`;
    const cachedData = myCache.get(cacheKey);
    if (cachedData) return res.json(cachedData);

    let query = Game.find();
    if (sort) {
      const sortOptions = {};
      sortOptions[sort] = order === "desc" ? -1 : 1;
      query = query.sort(sortOptions);
    }
    if (limit) query = query.limit(parseInt(limit, 10));

    const games = await query.exec();
    myCache.set(cacheKey, games);
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
    res.status(201).json(game);
  } catch (err) {
    if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
};

const updateGame = async (req, res) => {
  try {
    const updatedGame = await Game.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updatedGame) return res.status(404).json({ message: "Không tìm thấy game để cập nhật" });
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
    res.json({ message: "Đã xóa game thành công" });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID game không hợp lệ." });
    res.status(500).json({ message: err.message });
  }
};

const getRecommendations = async (req, res) => {
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
