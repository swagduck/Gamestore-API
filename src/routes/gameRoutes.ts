import express from 'express';
const router = express.Router();
import gameController from '../controllers/gameController';
import {  verifyAdmin  } from '../middlewares/authMiddleware';

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

export default router;
