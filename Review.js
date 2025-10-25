const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  game: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Game',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    required: true,
    trim: true,
  },
}, { timestamps: true });

// Ngăn một người dùng đánh giá một sản phẩm nhiều lần
ReviewSchema.index({ game: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Review', ReviewSchema);
