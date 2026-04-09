const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const orderController = require('../controllers/orderController');
const { verifyAdmin } = require('../middlewares/authMiddleware');

// All routes here are already prefixed with /api/admin from server.js
router.use(verifyAdmin);

// Analytics Admin
router.get('/ai-summary', analyticsController.getAiSummary);
router.get('/stats', analyticsController.getAdminStats);
router.put('/reset-views', analyticsController.resetViews);

// Order Admin
router.get('/orders', orderController.getAllOrdersAdmin);
router.put('/orders/:id/status', orderController.updateOrderStatus);

module.exports = router;
