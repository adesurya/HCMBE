// src/routes/articles.js
const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const { verifyToken, requireRole, optionalAuth, checkArticleAccess } = require('../middleware/auth');
const { articleValidation, idValidation, paginationValidation } = require('../middleware/validation');

// Public routes
router.get('/', paginationValidation, articleController.getArticles);
router.get('/featured', articleController.getFeaturedArticles);
router.get('/breaking', articleController.getBreakingNews);
router.get('/popular', articleController.getPopularArticles);
router.get('/category/:categoryId', idValidation, paginationValidation, articleController.getArticlesByCategory);
router.get('/:id', optionalAuth, checkArticleAccess, articleController.getArticle);
router.get('/:id/comments', idValidation, paginationValidation, articleController.getArticleComments);

// Protected routes
router.use(verifyToken);

// Like article (authenticated users)
router.post('/:id/like', idValidation, articleController.likeArticle);

// Admin/Editor/Journalist routes
router.get('/admin/all', requireRole(['admin', 'editor', 'journalist']), paginationValidation, articleController.getArticlesAdmin);
router.get('/admin/pending', requireRole(['admin', 'editor']), paginationValidation, articleController.getPendingArticles);
router.get('/admin/scheduled', requireRole(['admin', 'editor']), paginationValidation, articleController.getScheduledArticles);

// CRUD operations
router.post('/', requireRole(['admin', 'editor', 'journalist']), articleValidation.create, articleController.createArticle);
router.put('/:id', requireRole(['admin', 'editor', 'journalist']), idValidation, articleValidation.update, articleController.updateArticle);
router.delete('/:id', requireRole(['admin', 'editor', 'journalist']), idValidation, articleController.deleteArticle);

// Approval (editors only)
router.post('/:id/approve', requireRole(['admin', 'editor']), idValidation, articleController.approveArticle);

// Analytics
router.get('/:id/analytics', requireRole(['admin', 'editor', 'journalist']), idValidation, articleController.getArticleAnalytics);

module.exports = router;

