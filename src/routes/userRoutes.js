const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyAdmin } = require('../middlewares/authMiddleware');

router.get('/', verifyAdmin, userController.getAllUsers);
router.put('/:id/toggle-admin', verifyAdmin, userController.toggleAdminStatus);

module.exports = router;
