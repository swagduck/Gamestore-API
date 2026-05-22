import express from 'express';
const router = express.Router();
import authController from '../controllers/authController';
import {  authLimiter, checkRateLimit  } from '../middlewares/rateLimiter';
import {  verifyToken  } from '../middlewares/authMiddleware';
import validate from '../middlewares/validate';
import {  registerSchema, loginSchema  } from '../validations/auth.validation';

router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/google', checkRateLimit, authController.googleLogin); // rate limit nhẹ hơn cho OAuth
router.post('/forgot-password', authLimiter, authController.forgotPassword); // bảo vệ khỏi email spam
router.post('/reset-password', authLimiter, authController.resetPassword);   // bảo vệ khỏi brute-force token
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.getMe);
router.post('/refresh', verifyToken, authController.refreshToken);

export default router;
