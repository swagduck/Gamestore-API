const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');
const { verifyAdmin } = require('../middlewares/authMiddleware');

router.get('/', gameController.getAllGames);
router.get('/find', gameController.findGamesForChatbot);
router.get('/search', gameController.searchGames);
router.get('/discounted', gameController.getDiscountedGames);
router.get('/:id', gameController.getGameById);

router.post('/:id/view', gameController.trackGameView);
router.post('/recommendations', gameController.getRecommendations);

// Admin Routes
router.post('/', verifyAdmin, gameController.addGame);
router.put('/:id', verifyAdmin, gameController.updateGame);
router.delete('/:id', verifyAdmin, gameController.deleteGame);

module.exports = router;
