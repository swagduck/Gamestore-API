require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Order = require('./src/models/Order');
const { addExpAndCheckBadges } = require('./src/utils/leveling');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {
  console.log("Đã kết nối Database. Bắt đầu tính toán lại EXP...");
  
  const users = await User.find();
  let count = 0;
  
  for (const user of users) {
    const orders = await Order.find({ user: user._id, status: 'completed' });
    let totalGames = 0;
    
    orders.forEach(o => {
      totalGames += (o.items && o.items.length) ? o.items.length : 0;
    });
    
    // Đếm số bạn bè
    const friendsCount = (user.friends && user.friends.length) ? user.friends.length : 0;
    
    if (totalGames > 0 || friendsCount > 0) {
      console.log(`Đang tính lại cho User: ${user.email} | Game: ${totalGames} | Bạn bè: ${friendsCount}`);
      // Cộng bù EXP
      const expGained = (totalGames * 50) + (friendsCount * 50);
      
      // Reset trước
      user.exp = 0;
      user.level = 1;
      user.achievements = [];
      await user.save();
      
      // Chạy hàm tính
      await addExpAndCheckBadges(user._id, expGained, { gamesBought: totalGames });
      count++;
    }
  }
  
  console.log(`Hoàn tất! Đã cập nhật cho ${count} tài khoản.`);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
