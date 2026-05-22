import express from 'express';
const router = express.Router();
import notificationController from '../controllers/notificationController';
import {  verifyToken, verifyAdmin  } from '../middlewares/authMiddleware';

router.get('/', verifyToken, notificationController.getNotifications);
router.get('/count', verifyToken, notificationController.getUnreadCount);
router.put('/mark-all-read', verifyToken, notificationController.markAllAsRead);
router.put('/:id/read', verifyToken, notificationController.markAsRead);
router.post('/', verifyAdmin, notificationController.createNotification);

export default router;
