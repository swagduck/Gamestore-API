const mongoose = require("mongoose");
require("dotenv").config();
const Game = require("./Game.js");
const { fakeGames } = require("./gameData.js");

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Đã kết nối MongoDB để seed data...");

    // 1. Xóa tất cả game cũ (để tránh trùng lặp)
    await Game.deleteMany({});
    console.log("Đã xóa game cũ.");

    // 2. Thêm mảng gameData vào database
    // (Bỏ 'id' vì MongoDB sẽ tự tạo _id)
    const gamesToInsert = fakeGames.map(({ id, ...rest }) => rest);
    await Game.insertMany(gamesToInsert);
    console.log("Đã thêm dữ liệu game mới thành công!");
  } catch (error) {
    console.error("Lỗi khi seed data:", error);
  } finally {
    // 3. Ngắt kết nối
    mongoose.connection.close();
  }
};

seedDatabase();
