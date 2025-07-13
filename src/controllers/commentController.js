// src/controllers/commentController.js
const Comment = require('../models/Comment');
const Article = require('../models/Article');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

// Get comments for an article
const getComments = asyncHandler(async (req, res) => {
  const { articleId } = req.params;
  const {
    page = 1,
    limit = 10,
    status = 'approved',
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const article = await Article.findById(parseInt(articleId));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  // Only show approved comments to public, all comments to editors/admins
  const commentStatus = ['admin', 'editor'].includes(req.user?.role) ? 
    (status || 'approved') : 'approved';

  const result = await Comment.findByArticle(
    parseInt(articleId),
    parseInt(page),
    parseInt(limit),
    commentStatus,
    sortBy,
    sortOrder.toUpperCase()
  );

  res.json({
    success: true,
    data: {
      comments: result.comments.map(comment => comment.toPublicObject()),
      pagination: result.pagination
    }
  });
});

// Get all comments (admin/editor)
const getCommentsAdmin = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    article_id,
    user_id,
    search,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder: sortOrder.toUpperCase()
  };

  if (status) options.status = status;
  if (article_id) options.article_id = parseInt(article_id);
  if (user_id) options.user_id = parseInt(user_id);
  if (search) options.search = search;

  const result = await Comment.findAll(options);

  res.json({
    success: true,
    data: {
      comments: result.comments,
      pagination: result.pagination
    }
  });
});

// Create new comment
const createComment = asyncHandler(async (req, res) => {
  const {
    article_id,
    content,
    parent_id,
    author_name,
    author_email
  } = req.body;

  // Verify article exists
  const article = await Article.findById(parseInt(article_id));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  if (article.status !== 'published') {
    throw new AppError('Cannot comment on unpublished article', 400);
  }

  // Verify parent comment exists if provided
  if (parent_id) {
    const parentComment = await Comment.findById(parseInt(parent_id));
    if (!parentComment || parentComment.article_id !== parseInt(article_id)) {
      throw new AppError('Parent comment not found', 404);
    }
  }

  const commentData = {
    article_id: parseInt(article_id),
    content,
    parent_id: parent_id ? parseInt(parent_id) : null,
    ip_address: req.ip,
    user_agent: req.get('User-Agent')
  };

  // Set user info based on authentication
  if (req.user) {
    commentData.user_id = req.user.id;
  } else {
    if (!author_name || !author_email) {
      throw new AppError('Name and email are required for guest comments', 400);
    }
    commentData.author_name = author_name;
    commentData.author_email = author_email;
  }

  const comment = await Comment.create(commentData);

  // Send notification to article author (async)
  if (article.author && article.author.email) {
    try {
      await emailService.sendCommentNotification(article, comment);
    } catch (error) {
      logger.error('Failed to send comment notification:', error);
    }
  }

  // Send notification to parent comment author if it's a reply
  if (parent_id) {
    try {
      const parentComment = await Comment.findById(parseInt(parent_id));
      if (parentComment) {
        await emailService.sendReplyNotification(parentComment, comment, article);
      }
    } catch (error) {
      logger.error('Failed to send reply notification:', error);
    }
  }

  res.status(201).json({
    success: true,
    message: 'Comment submitted successfully. It will be reviewed before being published.',
    data: {
      comment: comment.toPublicObject()
    }
  });
});

// Update comment (user can only update their own)
const updateComment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;

  const comment = await Comment.findById(parseInt(id));
  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  // Check permissions
  if (req.user.role !== 'admin' && req.user.role !== 'editor') {
    if (!comment.user_id || comment.user_id !== req.user.id) {
      throw new AppError('You can only update your own comments', 403);
    }
  }

  // Only allow content updates for regular users
  const updates = { content };

  await comment.update(updates);

  res.json({
    success: true,
    message: 'Comment updated successfully',
    data: {
      comment: comment.toPublicObject()
    }
  });
});

// Delete comment
const deleteComment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const comment = await Comment.findById(parseInt(id));
  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  // Check permissions
  if (req.user.role !== 'admin' && req.user.role !== 'editor') {
    if (!comment.user_id || comment.user_id !== req.user.id) {
      throw new AppError('You can only delete your own comments', 403);
    }
  }

  await comment.delete();

  res.json({
    success: true,
    message: 'Comment deleted successfully'
  });
});

// Approve comment (admin/editor)
const approveComment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const comment = await Comment.findById(parseInt(id));
  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  await comment.approve();

  res.json({
    success: true,
    message: 'Comment approved successfully',
    data: {
      comment: comment.toPublicObject()
    }
  });
});

// Reject comment (admin/editor)
const rejectComment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const comment = await Comment.findById(parseInt(id));
  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  await comment.reject(reason);

  res.json({
    success: true,
    message: 'Comment rejected successfully'
  });
});

// Mark comment as spam (admin/editor)
const markAsSpam = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const comment = await Comment.findById(parseInt(id));
  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  await comment.markAsSpam();

  res.json({
    success: true,
    message: 'Comment marked as spam'
  });
});

// Get pending comments count
const getPendingCount = asyncHandler(async (req, res) => {
  const count = await Comment.getPendingCount();

  res.json({
    success: true,
    data: {
      pending_count: count
    }
  });
});

// Bulk actions on comments
const bulkAction = asyncHandler(async (req, res) => {
  const { comment_ids, action } = req.body;

  if (!Array.isArray(comment_ids) || comment_ids.length === 0) {
    throw new AppError('Comment IDs must be a non-empty array', 400);
  }

  if (!['approve', 'reject', 'spam', 'delete'].includes(action)) {
    throw new AppError('Invalid action', 400);
  }

  const results = await Comment.bulkAction(comment_ids, action);

  res.json({
    success: true,
    message: `Bulk ${action} completed`,
    data: {
      processed: results.processed,
      failed: results.failed
    }
  });
});

module.exports = {
  getComments,
  getCommentsAdmin,
  createComment,
  updateComment,
  deleteComment,
  approveComment,
  rejectComment,
  markAsSpam,
  getPendingCount,
  bulkAction
};