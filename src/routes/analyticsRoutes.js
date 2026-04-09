const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { verifyAdmin } = require('../middlewares/authMiddleware');

router.get('/', analyticsController.getAnalyticsData);
router.post('/track-view', analyticsController.trackGameView);
router.post('/add-order', analyticsController.addOrder);
router.put('/reset-views', verifyAdmin, analyticsController.resetViews);
router.post('/sync', analyticsController.syncAnalyticsData);

module.exports = router;
