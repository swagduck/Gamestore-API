const chatRateLimit = new Map(); // Simple in-memory rate limit

const checkRateLimit = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60000; // 1 minute window
  const maxRequests = 10; // Max 10 requests per minute per IP
  
  if (!chatRateLimit.has(clientIP)) {
    chatRateLimit.set(clientIP, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  const clientData = chatRateLimit.get(clientIP);
  
  if (now > clientData.resetTime) {
    // Reset window
    chatRateLimit.set(clientIP, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  if (clientData.count >= maxRequests) {
    return res.status(429).json({
      text: "Bot đang bận, vui lòng thử lại sau 1 phút!",
      error: "RATE_LIMIT_EXCEEDED"
    });
  }
  
  clientData.count++;
  next();
};

module.exports = { checkRateLimit };
