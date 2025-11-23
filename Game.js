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
  // Discount fields
  discountType: {
    type: String,
    enum: ['none', 'percentage', 'fixed'],
    default: 'none'
  },
  discountValue: {
    type: Number,
    min: 0
  },
  discountStartDate: {
    type: Date
  },
  discountEndDate: {
    type: Date
  }
});

// Thêm text index để tối ưu hóa tìm kiếm
GameSchema.index({ name: "text", description: "text" });

// Method to check if game discount is active
GameSchema.methods.hasActiveDiscount = function() {
  if (!this.discountType || this.discountType === 'none' || !this.discountValue) {
    return false;
  }
  
  const now = new Date();
  const start = this.discountStartDate ? new Date(this.discountStartDate) : null;
  const end = this.discountEndDate ? new Date(this.discountEndDate) : null;
  
  return (!start || now >= start) && (!end || now <= end);
};

// Method to get discounted price
GameSchema.methods.getDiscountedPrice = function() {
  if (!this.hasActiveDiscount()) {
    return this.price;
  }
  
  if (this.discountType === 'percentage') {
    return this.price * (1 - this.discountValue / 100);
  } else if (this.discountType === 'fixed') {
    return Math.max(0, this.price - this.discountValue);
  }
  
  return this.price;
};

module.exports = mongoose.model("Game", GameSchema);
