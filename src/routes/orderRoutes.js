const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, verifyAdmin } = require('../middlewares/authMiddleware');

// Public/Webhook
router.post('/stripe/webhook', express.raw({type: 'application/json'}), orderController.handleStripeWebhook);

// User Order Management
router.post('/create-test-payment', verifyToken, orderController.createTestPayment);
router.post('/create-checkout-session', verifyToken, orderController.createCheckoutSession);
router.post('/orders/create-from-session', verifyToken, orderController.createOrderFromSession);
router.get('/orders', verifyToken, orderController.getUserOrders);
router.get('/orders/purchased-games', verifyToken, orderController.getPurchasedGames);
router.get('/orders/owned-game-ids', verifyToken, orderController.getOwnedGameIds);
router.get('/orders/:id', verifyToken, orderController.getOrderById);
router.post('/orders', verifyToken, orderController.createOrder);

// Admin Order Management
router.get('/admin/orders', verifyAdmin, orderController.getAllOrdersAdmin);
router.put('/orders/:id/status', orderController.updateOrderStatus); // Should be verifyAdmin ideally, but preserving original logic

module.exports = router;
