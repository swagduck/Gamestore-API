import express from 'express';
const router = express.Router();
import chatController from '../controllers/chatController';
import {  checkRateLimit  } from '../middlewares/rateLimiter';
import {  verifyToken  } from '../middlewares/authMiddleware';

// AI Chatbot (GameBot)
router.post("/", checkRateLimit, chatController.handleChat);

// Chat bạn bè - REST API
router.get("/conversations", verifyToken, chatController.getConversations);
router.get("/history/:friendId", verifyToken, chatController.getChatHistory);

export default router;
