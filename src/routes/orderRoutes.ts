import express from 'express';
const router = express.Router();
import orderController from '../controllers/orderController';
import {  verifyToken, verifyAdmin  } from '../middlewares/authMiddleware';

// Public/Webhook
// (Đã chuyển qua server.js để lấy raw body)

// User Order Management
router.post('/create-test-payment', verifyToken, orderController.createTestPayment);
router.post('/create-checkout-session', verifyToken, orderController.createCheckoutSession);
router.post('/orders/create-from-session', verifyToken, orderController.createOrderFromSession);
router.get('/orders', verifyToken, orderController.getUserOrders);
router.get('/orders/purchased-games', verifyToken, orderController.getPurchasedGames);
router.get('/orders/owned-game-ids', verifyToken, orderController.getOwnedGameIds);
router.get('/orders/:id', verifyToken, orderController.getOrderById);
router.post('/orders', verifyToken, orderController.createOrder);

export default router;
