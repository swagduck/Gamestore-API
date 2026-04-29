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

module.exports = router;
