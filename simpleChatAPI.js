// Simple Chat API - Clean and reliable
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

    // Simple prompt for Gemini
    const prompt = `Bạn là trợ lý game Gam34Pers. Trả lời ngắn gọn, thân thiện về game.

User: ${message}
Answer:`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log('✅ Gemini Response:', text);

      res.json({
        text: text.trim(),
        success: true
      });

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

      res.json({
        text: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
        success: false
      });
    }

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
