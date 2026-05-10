const rateLimit = require('express-rate-limit');

// Bypass rate limiting khi chạy test để tránh 429 trong Jest
const skipInTest = (limiter) => {
  if (process.env.NODE_ENV === 'test') {
    return (req, res, next) => next();
  }
  return limiter;
};

const checkRateLimit = skipInTest(rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Giới hạn 10 request mỗi phút trên mỗi IP
  message: {
    text: "Bot đang bận, vui lòng thử lại sau 1 phút!",
    error: "RATE_LIMIT_EXCEEDED"
  },
  standardHeaders: true,
  legacyHeaders: false,
}));

const authLimiter = skipInTest(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 5, // Tối đa 5 lần thử sai
  message: {
    message: "Quá nhiều yêu cầu đăng nhập từ IP này, vui lòng thử lại sau 15 phút."
  },
  standardHeaders: true,
  legacyHeaders: false,
}));

module.exports = { checkRateLimit, authLimiter };

