const mongoose = require('mongoose');
const Game = require('./Game.js');
require('dotenv').config();

// Sample games data
const sampleGames = [
  {
    name: "Cyberpunk 2077",
    price: 59.99,
    platform: ["PC", "PlayStation 5", "Xbox Series X"],
    genre: ["Nhập vai", "Hành động"],
    image: "https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/cyberpunk_bezyis.jpg",
    description: "Game nhập vai hành động thế giới mở",
    viewCount: 1250,
    rating: 4.2,
    numReviews: 156
  },
  {
    name: "Elden Ring",
    price: 49.99,
    platform: ["PC", "PlayStation 5", "Xbox Series X"],
    genre: ["Nhập vai", "Hành động", "Phiêu lưu"],
    image: "https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/eldenring_o7vz0f.jpg",
    description: "Game nhập vai hành động phiêu lưu",
    viewCount: 2100,
    rating: 4.8,
    numReviews: 342
  },
  {
    name: "Starfield",
    price: 69.99,
    platform: ["PC", "Xbox Series X"],
    genre: ["Nhập vai", "Phiêu lưu"],
    image: "https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/starfield_ljxq9k.jpg",
    description: "Game phiêu lưu không gian",
    viewCount: 890,
    rating: 4.1,
    numReviews: 98
  }
];

async function seedDatabase() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to database');

    // Clear existing games
    await Game.deleteMany({});
    console.log('Cleared existing games');

    // Insert sample games
    const insertedGames = await Game.insertMany(sampleGames);
    console.log(`Inserted ${insertedGames.length} games`);

    // Verify insertion
    const count = await Game.countDocuments();
    console.log(`Total games in database: ${count}`);

    console.log('Database seeded successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.disconnect();
  }
}

seedDatabase();
