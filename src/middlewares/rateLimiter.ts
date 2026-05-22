import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

// Bypass rate limiting khi chạy test để tránh 429 trong Jest
const skipInTest = (limiter: any) => {
  if (process.env.NODE_ENV === 'test') {
    return (req: Request, res: Response, next: NextFunction) => next();
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

const friendRequestLimiter = skipInTest(rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 20, // Tối đa 20 lời mời kết bạn mỗi giờ
  message: {
    message: "Bạn đã gửi quá nhiều lời mời kết bạn. Vui lòng thử lại sau 1 giờ."
  },
  standardHeaders: true,
  legacyHeaders: false,
}));

const reviewLimiter = skipInTest(rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 giờ
  max: 10, // Tối đa 10 review mỗi ngày
  message: {
    message: "Bạn đã gửi quá nhiều đánh giá hôm nay. Vui lòng thử lại vào ngày mai."
  },
  standardHeaders: true,
  legacyHeaders: false,
}));



export { skipInTest, checkRateLimit, authLimiter, friendRequestLimiter, reviewLimiter };
