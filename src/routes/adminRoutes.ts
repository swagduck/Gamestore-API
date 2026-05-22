import express from 'express';
const router = express.Router();
import analyticsController from '../controllers/analyticsController';
import orderController from '../controllers/orderController';
import {  verifyAdmin  } from '../middlewares/authMiddleware';

// All routes here are already prefixed with /api/admin from server.js
router.use(verifyAdmin);

// Analytics Admin
router.get('/ai-summary', analyticsController.getAiSummary);
router.get('/stats', analyticsController.getAdminStats);
router.put('/reset-views', analyticsController.resetViews);

// Order Admin
router.get('/orders', orderController.getAllOrdersAdmin);
router.put('/orders/:id/status', orderController.updateOrderStatus);

export default router;
