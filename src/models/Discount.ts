import mongoose from "mongoose";

const DiscountSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z0-9]{3,20}$/
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['percentage', 'fixed'],
    default: 'percentage'
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  minOrderValue: {
    type: Number,
    min: 0
  },
  maxDiscountAmount: {
    type: Number,
    min: 0
  },
  usageLimit: {
    type: Number,
    min: 1
  },
  usageCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now as any as any
  },
  updatedAt: {
    type: Date,
    default: Date.now as any as any
  }
});

// Update the updatedAt field before saving
DiscountSchema.pre('save', function(next) {
  // @ts-ignore - TODO: Fix TS error
  this.updatedAt = Date.now();
  next();
});

// Method to check if discount is currently active
DiscountSchema.methods.isActiveNow = function() {
  if (!this.isActive) return false;
  
  const now = new Date();
  return now >= this.startDate && now <= this.endDate;
};

// Method to check if discount can be used
DiscountSchema.methods.canBeUsed = function() {
  if (!this.isActiveNow()) return false;
  
  if (this.usageLimit && this.usageCount >= this.usageLimit) return false;
  
  return true;
};

// Method to increment usage count
DiscountSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  return this.save();
};

export default mongoose.model("Discount", DiscountSchema);
