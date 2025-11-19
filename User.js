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
    // Bạn có thể thêm các trường khác sau này (ví dụ: name, address, ...)
  },
  { timestamps: true }
); // Tự động thêm createdAt và updatedAt

module.exports = mongoose.model("User", UserSchema);
