// my-ecommerce-api/User.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true, // Email phải là duy nhất
      lowercase: true, // Luôn lưu email dưới dạng chữ thường
      trim: true, // Bỏ khoảng trắng thừa
    },
    password: {
      type: String,
      required: true,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true // Allows multiple nulls for users without Google accounts
    },
    name: {
      type: String
    },
    avatar: {
      type: String
    }
  },
  { timestamps: true }
); // Tự động thêm createdAt và updatedAt

module.exports = mongoose.model("User", UserSchema);
