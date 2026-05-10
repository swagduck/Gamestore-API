const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authLimiter, checkRateLimit } = require('../middlewares/rateLimiter');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/google', checkRateLimit, authController.googleLogin); // rate limit nhẹ hơn cho OAuth
router.post('/forgot-password', authLimiter, authController.forgotPassword); // bảo vệ khỏi email spam
router.post('/reset-password', authLimiter, authController.resetPassword);   // bảo vệ khỏi brute-force token
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.getMe);

module.exports = router;
