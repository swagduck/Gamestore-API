const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { verifyAdmin } = require('../middlewares/authMiddleware');

router.get('/', analyticsController.getAnalyticsData);
router.post('/track-view', analyticsController.trackGameView);
router.post('/add-order', analyticsController.addOrder);
router.put('/reset-views', verifyAdmin, analyticsController.resetViews);
router.post('/sync', analyticsController.syncAnalyticsData);

// Admin specific endpoints (Moved from orderAdminController layout into here)
router.get('/admin/ai-summary', verifyAdmin, analyticsController.getAiSummary);
router.get('/admin/stats', verifyAdmin, analyticsController.getAdminStats);

module.exports = router;
