import express from 'express';
const router = express.Router();
import analyticsController from '../controllers/analyticsController';
import {  verifyAdmin  } from '../middlewares/authMiddleware';

router.get('/', analyticsController.getAnalyticsData);
router.post('/track-view', analyticsController.trackGameView);
router.post('/add-order', analyticsController.addOrder);
router.put('/reset-views', verifyAdmin, analyticsController.resetViews);
router.post('/sync', analyticsController.syncAnalyticsData);

export default router;
