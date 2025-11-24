const mongoose = require('mongoose');
const Game = require('./Game');

mongoose.connect('mongodb+srv://hoanguy:Z162wMcmQhICmXcb@mongodb.p9ncspb.mongodb.net/gameDatabase?retryWrites=true&w=majority&appName=MongoDB')
.then(async () => {
  console.log('Connected to MongoDB');
  
  // Image URLs mapping with regex patterns
  const gamePatterns = [
    { pattern: /hogwarts/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/hogwarts-optimized.jpg' },
    { pattern: /elden.*ring/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/eldenring-optimized.jpg' },
    { pattern: /cyberpunk/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/cyberpunk-optimized.jpg' },
    { pattern: /god.*war/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/godofwar-optimized.jpg' },
    { pattern: /stardew/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/stardew-optimized.jpg' },
    { pattern: /starfield/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/starfield-optimized.jpg' },
    { pattern: /zelda/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/zelda-optimized.jpg' },
    { pattern: /red.*dead/i, image: 'https://res.cloudinary.com/dfkac2u3x/image/upload/v1761107166/rdr2-optimized.jpg' }
  ];
  
  // Update each game pattern
  for (const { pattern, image } of gamePatterns) {
    const result = await Game.updateMany(
      { name: { $regex: pattern } },
      { $set: { image } }
    );
    console.log(`Pattern ${pattern}: ${result.modifiedCount} games updated`);
  }
  
  process.exit(0);
})
.catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
