const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { checkRateLimit } = require('../middlewares/rateLimiter');

router.post("/", checkRateLimit, chatController.handleChat);

module.exports = router;
