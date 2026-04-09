const express = require('express');
const router = express.Router({ mergeParams: true });
const reviewController = require('../controllers/reviewController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Note: /api/games/:id/reviews and /api/reviews/:id are mixed in standard layout.
// I'll group them for simplicity, assuming base route is /api/reviews and we proxy games reviews.
// Wait, the endpoints from server.js were:
// GET /api/games/:id/reviews
// POST /api/games/:id/reviews
// PUT /api/reviews/:id/helpful
// POST /api/reviews/:id/report

router.get('/games/:id/reviews', reviewController.getReviewsForGame);
router.post('/games/:id/reviews', verifyToken, reviewController.addReview);
router.put('/reviews/:id/helpful', reviewController.markReviewHelpful);
router.post('/reviews/:id/report', reviewController.reportReview);

module.exports = router;
