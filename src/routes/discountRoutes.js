const express = require('express');
const router = express.Router();
const discountController = require('../controllers/discountController');
const { verifyAdmin } = require('../middlewares/authMiddleware');

router.get('/', verifyAdmin, discountController.getAllDiscounts);
router.post('/', verifyAdmin, discountController.createDiscount);
router.get('/:id', verifyAdmin, discountController.getDiscountById);
router.put('/:id', verifyAdmin, discountController.updateDiscount);
router.delete('/:id', verifyAdmin, discountController.deleteDiscount);
router.post('/validate', discountController.validateDiscount);

module.exports = router;
