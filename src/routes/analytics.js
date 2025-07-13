// src/routes/analytics.js
const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { idValidation } = require('../middleware/validation');

// All routes require authentication
router.use(verifyToken);
router.use(requireRole(['admin', 'editor', 'journalist']));

router.get('/dashboard', analyticsController.getDashboard);
router.get('/articles/top', analyticsController.getTopArticles);
router.get('/traffic', analyticsController.getTrafficStats);
router.get('/users', analyticsController.getUserStats);
router.get('/export', analyticsController.exportAnalytics);

// Journalist can only see their own article analytics
router.get('/articles/:id', idValidation, analyticsController.getArticleAnalytics);

module.exports = router;

