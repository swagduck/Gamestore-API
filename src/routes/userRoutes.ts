import express from 'express';
const router = express.Router();
import userController from '../controllers/userController';
import {  verifyAdmin, verifyToken  } from '../middlewares/authMiddleware';
import {  friendRequestLimiter  } from '../middlewares/rateLimiter';
import {  upload  } from '../utils/cloudinary';

// Lấy danh sách users (Admin)
router.get('/', verifyAdmin, userController.getAllUsers);

// Cấp/Huỷ quyền admin
router.put('/:id/toggle-admin', verifyAdmin, userController.toggleAdminStatus);

// Cập nhật profile user hiện tại
router.put('/profile', verifyToken, upload.single('avatar'), userController.updateUserProfile);

// --- ROUTES BẠN BÈ & PROFILE ---
router.get('/profile/:id', verifyToken, userController.getPublicProfile);
router.get('/friends', verifyToken, userController.getFriends);
router.post('/friends/request', verifyToken, friendRequestLimiter, userController.sendFriendRequest);
router.post('/friends/accept', verifyToken, userController.acceptFriendRequest);
router.post('/friends/reject', verifyToken, userController.rejectFriendRequest);
router.post('/friends/remove', verifyToken, userController.removeFriend);

export default router;
