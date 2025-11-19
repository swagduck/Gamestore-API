const mongoose = require("mongoose");

const GameSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  platform: [{ type: String, required: true }],
  genre: [{ type: String, required: true }],
  image: { type: String, required: true },
  description: { type: String, required: true },
  rating: {
    type: Number,
    required: true,
    default: 0,
  },
  numReviews: {
    type: Number,
    required: true,
    default: 0,
  },
});

// Thêm text index để tối ưu hóa tìm kiếm
GameSchema.index({ name: "text", description: "text" });

module.exports = mongoose.model("Game", GameSchema);
