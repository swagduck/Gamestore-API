const rateLimit = require('express-rate-limit');

const checkRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Giới hạn 10 request mỗi phút trên mỗi IP
  message: {
    text: "Bot đang bận, vui lòng thử lại sau 1 phút!",
    error: "RATE_LIMIT_EXCEEDED"
  },
  standardHeaders: true, 
  legacyHeaders: false, 
});

module.exports = { checkRateLimit };
