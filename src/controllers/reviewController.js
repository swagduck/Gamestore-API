const Review = require("../models/Review");
const Game = require("../models/Game");
const NodeCache = require("node-cache");
const myCache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

const getReviewsForGame = async (req, res) => {
  try {
    const cacheKey = `reviews_${req.params.id}`;
    const cachedData = myCache.get(cacheKey);
    if (cachedData) return res.json(cachedData);

    const reviews = await Review.find({ game: req.params.id })
      .populate("user", "email")
      .sort({ createdAt: -1 });

    myCache.set(cacheKey, reviews);
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const markReviewHelpful = async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $inc: { helpful: 1 } },
      { new: true }
    );
    if (!review) return res.status(404).json({ message: "Không tìm thấy đánh giá." });
    res.json(review);
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const reportReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $inc: { reportCount: 1 } },
      { new: true }
    );
    if (!review) return res.status(404).json({ message: "Không tìm thấy đánh giá." });
    res.json({ message: "Đã báo cáo đánh giá thành công." });
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const addReview = async (req, res) => {
  const { rating, comment } = req.body;
  const gameId = req.params.id;
  const userId = req.user._id;

  try {
    const game = await Game.findById(gameId);
    if (!game) return res.status(404).json({ message: "Không tìm thấy game." });

    let review = await Review.findOne({ game: gameId, user: userId });

    if (review) {
      review.rating = Number(rating);
      review.comment = comment;
      await review.save();
    } else {
      review = new Review({ game: gameId, user: userId, rating: Number(rating), comment });
      await review.save();
    }

    const reviews = await Review.find({ game: gameId });
    game.numReviews = reviews.length;
    game.rating = reviews.reduce((acc, item) => item.rating + acc, 0) / reviews.length;
    await game.save();

    myCache.del(`reviews_${gameId}`);

    res.status(review.isNew ? 201 : 200).json({ 
      message: review.isNew ? "Cảm ơn bạn đã đánh giá!" : "Đã cập nhật đánh giá của bạn!",
      review 
    });
  } catch (error) {
    if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Lỗi máy chủ khi thêm đánh giá." });
  }
};

module.exports = { getReviewsForGame, markReviewHelpful, reportReview, addReview };
