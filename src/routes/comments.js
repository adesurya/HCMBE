// src/routes/comments.js
const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');
const { verifyToken, requireRole, optionalAuth } = require('../middleware/auth');
const { commentValidation, idValidation, paginationValidation } = require('../middleware/validation');
const { rateLimiters } = require('../middleware/security');

// Public routes
router.get('/article/:articleId', idValidation, paginationValidation, commentController.getComments);

// Protected routes
router.use(optionalAuth);

// Create comment (rate limited)
router.post('/', rateLimiters.comment, commentValidation.create, commentController.createComment);

// Authenticated routes
router.use(verifyToken);

// User can update/delete their own comments
router.put('/:id', idValidation, commentController.updateComment);
router.delete('/:id', idValidation, commentController.deleteComment);

// Admin/Editor routes
router.get('/admin/all', requireRole(['admin', 'editor']), paginationValidation, commentController.getCommentsAdmin);
router.post('/:id/approve', requireRole(['admin', 'editor']), idValidation, commentController.approveComment);
router.post('/:id/reject', requireRole(['admin', 'editor']), idValidation, commentController.rejectComment);
router.post('/:id/spam', requireRole(['admin', 'editor']), idValidation, commentController.markAsSpam);

module.exports = router;

