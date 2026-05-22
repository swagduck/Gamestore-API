import express from 'express';
const router = express.Router();
import discountController from '../controllers/discountController';
import {  verifyAdmin  } from '../middlewares/authMiddleware';

router.get('/', verifyAdmin, discountController.getAllDiscounts);
router.post('/', verifyAdmin, discountController.createDiscount);
router.get('/:id', verifyAdmin, discountController.getDiscountById);
router.put('/:id', verifyAdmin, discountController.updateDiscount);
router.delete('/:id', verifyAdmin, discountController.deleteDiscount);
router.post('/validate', discountController.validateDiscount);

export default router;
