const mongoose = require('mongoose');
const Game = require('./Game.js');
const { fakeGames } = require('./gameData.js');

// Connect to the production database
const MONGO_URI = 'mongodb+srv://hoanguy:22289604@mongodb.p9ncspb.mongodb.net/gameDatabase?retryWrites=true&w=majority&appName=MongoDB';

// Convert fakeGames to match Game schema
const fullGameData = fakeGames.map(game => ({
  name: game.name,
  price: game.price,
  platform: game.platform,
  genre: game.genre,
  image: game.image.startsWith('http') ? game.image : `https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/${game.name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}_optimized.jpg`,
  description: game.description,
  viewCount: Math.floor(Math.random() * 3000) + 500, // Random view count between 500-3500
  rating: Number((Math.random() * 2 + 3).toFixed(1)), // Random rating between 3.0-5.0
  numReviews: Math.floor(Math.random() * 500) + 50, // Random reviews between 50-550
  isFree: game.price === 0 || game.price === 14.99 ? Math.random() > 0.8 : false // Some low price games might be free
}));

async function seedFullDatabase() {
  try {
    console.log('Connecting to production database...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to production database');

    // Check existing games
    const existingCount = await Game.countDocuments();
    console.log(`Current games in database: ${existingCount}`);

    // Clear existing games if needed, or add to existing
    const clearExisting = existingCount > 0;
    if (clearExisting) {
      await Game.deleteMany({});
      console.log('Cleared existing games');
    }

    // Insert all games
    const insertedGames = await Game.insertMany(fullGameData);
    console.log(`Inserted ${insertedGames.length} games`);

    // Verify insertion
    const count = await Game.countDocuments();
    console.log(`Total games in database: ${count}`);

    // Show sample games
    const sampleGames = await Game.find().limit(3);
    console.log('\nSample games:');
    sampleGames.forEach(game => {
      console.log(`- ${game.name} ($${game.price}) - Rating: ${game.rating}`);
    });

    console.log('\n✅ Production database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding production database:', error);
  } finally {
    await mongoose.disconnect();
  }
}

seedFullDatabase();
