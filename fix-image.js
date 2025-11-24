const mongoose = require('mongoose');
const Game = require('./Game');

mongoose.connect('mongodb+srv://hoanguy:Z162wMcmQhICmXcb@mongodb.p9ncspb.mongodb.net/gameDatabase?retryWrites=true&w=majority&appName=MongoDB')
.then(async () => {
  console.log('Connected to MongoDB');
  
  // Default image for games without specific images
  const defaultImage = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
  
  // Get all games
  const allGames = await Game.find({});
  console.log(`Found ${allGames.length} games`);
  
  let updatedCount = 0;
  
  // Update each game with appropriate image based on name
  for (const game of allGames) {
    let imageUrl = defaultImage;
    
    // Specific image mappings (using local URLs)
    if (game.name.toLowerCase().includes('hogwarts')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/hogwarts-optimized.jpg';
    } else if (game.name.toLowerCase().includes('elden')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/eldenring-optimized.jpg';
    } else if (game.name.toLowerCase().includes('cyberpunk')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('god') && game.name.toLowerCase().includes('war')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/godofwar-optimized.jpg';
    } else if (game.name.toLowerCase().includes('stardew')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/stardew-optimized.jpg';
    } else if (game.name.toLowerCase().includes('starfield')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/starfield-optimized.jpg';
    } else if (game.name.toLowerCase().includes('zelda')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/zelda-optimized.jpg';
    } else if (game.name.toLowerCase().includes('red') && game.name.toLowerCase().includes('dead')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/rdr2-optimized.jpg';
    } else if (game.name.toLowerCase().includes('gta') || game.name.toLowerCase().includes('grand theft auto')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('spider')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('dragon')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('dark souls')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('payday')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('resident')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('call of duty') || game.name.toLowerCase().includes('cod')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('farming')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/stardew-optimized.jpg';
    } else if (game.name.toLowerCase().includes('truck')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('car')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('house')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('simulator')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/stardew-optimized.jpg';
    } else if (game.name.toLowerCase().includes('outlast')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    } else if (game.name.toLowerCase().includes('phasmophobia')) {
      imageUrl = 'https://my-ecommerce-3mdxa4qep-swagducks-projects.vercel.app/cyberpunk-optimized.jpg';
    }
    
    // Update the game
    await Game.updateOne(
      { _id: game._id },
      { $set: { image: imageUrl } }
    );
    
    updatedCount++;
    console.log(`✅ Updated: ${game.name}`);
  }
  
  console.log(`\n🎮 Total games updated: ${updatedCount}/${allGames.length}`);
  process.exit(0);
})
.catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
