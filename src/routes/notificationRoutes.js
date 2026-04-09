const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyToken, verifyAdmin } = require('../middlewares/authMiddleware');

router.get('/', verifyToken, notificationController.getNotifications);
router.get('/count', verifyToken, notificationController.getUnreadCount);
router.put('/:id/read', verifyToken, notificationController.markAsRead);
router.post('/', verifyAdmin, notificationController.createNotification);

module.exports = router;
