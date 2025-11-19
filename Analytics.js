const mongoose = require("mongoose");

const AnalyticsSchema = new mongoose.Schema({
  gameViews: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  orders: [{
    _id: String,
    items: [{
      gameId: String,
      name: String,
      price: Number,
      quantity: Number,
      platform: [String],
      genre: [String]
    }],
    total: Number,
    itemCount: Number,
    date: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      default: 'completed'
    }
  }],
  games: [{
    _id: String,
    name: String
  }],
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Index để tối ưu hóa queries
AnalyticsSchema.index({ 'orders.date': -1 });
AnalyticsSchema.index({ lastUpdated: -1 });

module.exports = mongoose.model("Analytics", AnalyticsSchema);
