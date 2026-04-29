const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyAdmin, verifyToken } = require('../middlewares/authMiddleware');
const { upload } = require('../utils/cloudinary');

// Lấy danh sách users (Admin)
router.get('/', verifyAdmin, userController.getAllUsers);

// Cấp/Huỷ quyền admin
router.put('/:id/toggle-admin', verifyAdmin, userController.toggleAdminStatus);

// Cập nhật profile user hiện tại
router.put('/profile', verifyToken, upload.single('avatar'), userController.updateUserProfile);

// --- ROUTES BẠN BÈ ---
router.get('/friends', verifyToken, userController.getFriends);
router.post('/friends/request', verifyToken, userController.sendFriendRequest);
router.post('/friends/accept', verifyToken, userController.acceptFriendRequest);
router.post('/friends/reject', verifyToken, userController.rejectFriendRequest);
router.post('/friends/remove', verifyToken, userController.removeFriend);

module.exports = router;
