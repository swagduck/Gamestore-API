const mongoose = require('mongoose');
const Order = require('./Order');
const Analytics = require('./Analytics');
require('dotenv').config();

async function runVerification() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // 1. Verify syncAnalytics (simulated)
    console.log('Testing syncAnalytics logic...');
    
    // Create a dummy order
    const dummyOrder = {
      _id: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      items: [{
        game: new mongoose.Types.ObjectId(),
        name: 'Verification Game ' + Date.now(),
        price: 9.99,
        quantity: 1,
        finalPrice: 9.99,
        platform: ['PC'],
        genre: ['Action']
      }],
      totalAmount: 9.99,
      status: 'completed',
      createdAt: new Date()
    };

    // Replicate syncAnalytics logic for verification
    const items = dummyOrder.items;
    const syncUpdate = {
      $push: {
        orders: {
          _id: dummyOrder._id.toString(),
          userId: dummyOrder.user.toString(),
          items: items.map(item => ({
            gameId: item.game.toString(),
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            finalPrice: item.finalPrice,
            platform: item.platform,
            genre: item.genre
          })),
          total: dummyOrder.totalAmount,
          itemCount: items.length,
          date: dummyOrder.createdAt,
          status: 'completed'
        }
      },
      $set: { lastUpdated: new Date() }
    };

    const analytics = await Analytics.findOneAndUpdate({}, syncUpdate, { upsert: true, new: true });
    console.log('✅ Analytics order push successful');

    // Verify game list update
    for (const item of items) {
      const gId = item.game.toString();
      const gameExists = analytics.games.some(g => g._id === gId);
      if (!gameExists) {
        await Analytics.findOneAndUpdate(
          {},
          { $push: { games: { _id: gId, name: item.name } } }
        );
        console.log(`✅ Game ${item.name} added to analytics games list`);
      }
    }

    // Clean up
    await Analytics.updateOne({}, { $pull: { orders: { _id: dummyOrder._id.toString() } } });
    for (const item of items) {
       await Analytics.updateOne({}, { $pull: { games: { _id: item.game.toString() } } });
    }
    console.log('✅ Cleanup successful');

    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

runVerification();
