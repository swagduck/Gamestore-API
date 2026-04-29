const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { checkRateLimit } = require('../middlewares/rateLimiter');
const { verifyToken } = require('../middlewares/authMiddleware');

// AI Chatbot (GameBot)
router.post("/", checkRateLimit, chatController.handleChat);

// Chat bạn bè - REST API
router.get("/conversations", verifyToken, chatController.getConversations);
router.get("/history/:friendId", verifyToken, chatController.getChatHistory);

module.exports = router;
