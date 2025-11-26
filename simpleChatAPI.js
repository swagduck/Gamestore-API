// Simple Chat API - Clean and reliable
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Game = require("./Game.js");

const router = express.Router();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// Simple rate limiting (in-memory)
const rateLimitMap = new Map();

const checkRateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 15; // 15 requests per minute

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return next();
  }

  const data = rateLimitMap.get(ip);
  if (now > data.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return next();
  }

  if (data.count >= maxRequests) {
    return res.status(429).json({
      text: "Bot đang bận, vui lòng thử lại sau 1 phút!",
      error: "RATE_LIMIT"
    });
  }

  data.count++;
  next();
};

// Search games function
const searchGames = async (query) => {
  try {
    let searchQuery = {};
    let shouldSearch = false;
    
    // Only search if message contains game-related keywords
    const gameKeywords = [
      'hành động', 'nhập vai', 'phiêu lưu', 'mô phỏng', 'chiến thuật', 
      'kinh dị', 'thể thao', 'đua xe', 'miễn phí', 'giá rẻ', 'rẻ',
      'game', 'trò chơi', 'chơi', 'tìm', 'gợi ý', 'hay'
    ];
    
    const hasGameKeyword = gameKeywords.some(keyword => 
      query.toLowerCase().includes(keyword)
    );
    
    // Don't search for greetings or simple messages
    const greetings = ['chào', 'hello', 'xin chào', 'hi', 'hey'];
    const isGreeting = greetings.some(greeting => 
      query.toLowerCase().includes(greeting)
    );
    
    if (!hasGameKeyword || isGreeting) {
      return []; // Don't search for greetings or non-game messages
    }
    
    // Extract game type from message
    if (query.toLowerCase().includes('hành động')) {
      searchQuery.genre = 'Hành động';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('nhập vai')) {
      searchQuery.genre = 'Nhập vai';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('phiêu lưu')) {
      searchQuery.genre = 'Phiêu lưu';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('mô phỏng')) {
      searchQuery.genre = 'Mô phỏng';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('chiến thuật')) {
      searchQuery.genre = 'Chiến thuật';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('kinh dị')) {
      searchQuery.genre = 'Kinh dị';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('thể thao')) {
      searchQuery.genre = 'Thể thao';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('đua xe')) {
      searchQuery.genre = 'Đua xe';
      shouldSearch = true;
    } else if (query.toLowerCase().includes('miễn phí')) {
      searchQuery.price = 0;
      shouldSearch = true;
    } else if (query.toLowerCase().includes('giá rẻ') || query.toLowerCase().includes('rẻ')) {
      searchQuery.price = { $lte: 20 };
      shouldSearch = true;
    } else if (query.toLowerCase().includes('game') || query.toLowerCase().includes('trò chơi')) {
      shouldSearch = true; // General game search
    }
    
    if (!shouldSearch) {
      return [];
    }
    
    // Search in database
    const games = await Game.find(searchQuery).limit(5);
    return games;
  } catch (error) {
    console.error('Search games error:', error);
    return [];
  }
};

// Chat endpoint
router.post("/chat", checkRateLimit, async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        text: "Bạn chưa nhập tin nhắn nào!",
        error: "EMPTY_MESSAGE"
      });
    }

    console.log('🤖 Chat Request:', message);

    // First, try to search for games
    const gameResults = await searchGames(message);
    
    let responseText = '';
    
    if (gameResults.length > 0) {
      // Found games, create response with game suggestions
      const gameList = gameResults.map(game => 
        `🎮 **${game.name}**\n   📝 ${game.description?.substring(0, 100) || 'Game hay'}...\n   💰 $${game.price}\n   ⭐ ${game.rating || '4.5'}/5`
      ).join('\n\n');
      
      responseText = `Tôi tìm thấy ${gameResults.length} game hay cho bạn:\n\n${gameList}\n\n🎯 Bạn muốn biết thêm về game nào không?`;
    } else {
      // No games found, use Gemini AI
      const prompt = `Bạn là trợ lý game Gam34Pers. Trả lời ngắn gọn, thân thiện về game.

User: ${message}
Answer:`;

      try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        responseText = response.text();
        console.log('✅ Gemini Response:', responseText);
      } catch (geminiError) {
        console.error('❌ Gemini Error:', geminiError);
        
        // Check if it's a quota/rate limit error
        if (geminiError.message.includes('quota') || 
            geminiError.message.includes('limit') || 
            geminiError.status === 429) {
          return res.status(429).json({
            text: "Bot đang quá tải, vui lòng thử lại sau vài phút!",
            error: "QUOTA_EXCEEDED"
          });
        }

        // Fallback response
        const fallbackResponses = [
          "Xin lỗi, tôi đang gặp sự cố kỹ thuật. Bạn có thể thử lại không?",
          "Tôi không thể kết nối đến AI ngay bây giờ. Bạn có thể hỏi tôi về game cụ thể không?",
          "Có lỗi xảy ra. Bạn muốn tìm game theo thể loại nào?"
        ];

        responseText = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
      }
    }

    res.json({
      text: responseText.trim(),
      results: gameResults,
      success: true
    });

  } catch (error) {
    console.error('❌ Chat API Error:', error);
    res.status(500).json({
      text: "Có lỗi xảy ra. Vui lòng thử lại sau!",
      error: "SERVER_ERROR"
    });
  }
});

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 300000);

module.exports = router;
