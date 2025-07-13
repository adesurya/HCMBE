// src/controllers/articleController.js
const Article = require('../models/Article');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const analyticsService = require('../services/analyticsService');
const emailService = require('../services/emailService');
const logger = require('../../scripts/baksrc/utils/logger');

// Get all articles (public)
const getArticles = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    category_id,
    author_id,
    search,
    is_featured,
    is_breaking,
    sortBy = 'published_at',
    sortOrder = 'DESC'
  } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    status: 'published', // Only published articles for public
    sortBy,
    sortOrder: sortOrder.toUpperCase()
  };

  if (category_id) options.category_id = parseInt(category_id);
  if (author_id) options.author_id = parseInt(author_id);
  if (search) options.search = search;
  if (is_featured !== undefined) options.is_featured = is_featured === 'true';
  if (is_breaking !== undefined) options.is_breaking = is_breaking === 'true';

  const result = await Article.findAll(options);

  res.json({
    success: true,
    data: {
      articles: result.articles.map(article => article.toSummaryObject()),
      pagination: result.pagination
    }
  });
});

// Get all articles for admin/editor
const getArticlesAdmin = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    category_id,
    author_id,
    search,
    is_featured,
    is_breaking,
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
  if (category_id) options.category_id = parseInt(category_id);
  if (author_id) options.author_id = parseInt(author_id);
  if (search) options.search = search;
  if (is_featured !== undefined) options.is_featured = is_featured === 'true';
  if (is_breaking !== undefined) options.is_breaking = is_breaking === 'true';

  // Journalists can only see their own articles
  if (req.user.role === 'journalist') {
    options.author_id = req.user.id;
  }

  const result = await Article.findAll(options);

  res.json({
    success: true,
    data: {
      articles: result.articles,
      pagination: result.pagination
    }
  });
});

// Get single article
const getArticle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSlug = isNaN(id);

  let article;
  if (isSlug) {
    article = await Article.findBySlug(id);
  } else {
    article = await Article.findById(parseInt(id));
  }

  if (!article) {
    throw new AppError('Article not found', 404);
  }

  // Check if user can access this article
  if (article.status !== 'published') {
    if (!req.user) {
      throw new AppError('Article not found', 404);
    }

    // Admin and editors can access all articles
    if (req.user.role !== 'admin' && req.user.role !== 'editor') {
      // Journalists can only access their own articles
      if (req.user.role === 'journalist' && article.author_id !== req.user.id) {
        throw new AppError('Article not found', 404);
      }
      // Regular users cannot access unpublished articles
      if (req.user.role === 'user') {
        throw new AppError('Article not found', 404);
      }
    }
  }

  // Track analytics for published articles
  if (article.status === 'published') {
    try {
      await analyticsService.trackView(article.id, req);
      // Increment view count
      await article.incrementViews();
    } catch (error) {
      logger.error('Analytics tracking error:', error);
    }
  }

  // Get related articles
  const relatedArticles = await article.getRelatedArticles(5);

  res.json({
    success: true,
    data: {
      article: article.toPublicObject(),
      related_articles: relatedArticles.map(a => a.toSummaryObject())
    }
  });
});

// Create new article
const createArticle = asyncHandler(async (req, res) => {
  const {
    title,
    content,
    excerpt,
    category_id,
    featured_image,
    meta_title,
    meta_description,
    meta_keywords,
    is_featured = false,
    is_breaking = false,
    status = 'draft',
    scheduled_at,
    tags = []
  } = req.body;

  // Check permissions
  if (!req.user.canPerformAction('create')) {
    throw new AppError('Insufficient permissions to create articles', 403);
  }

  // Journalists can only create drafts and ready_to_post
  if (req.user.role === 'journalist' && !['draft', 'ready_to_post'].includes(status)) {
    throw new AppError('Journalists can only create drafts or submit for approval', 403);
  }

  // Only admin and editors can publish directly
  if (status === 'published' && !['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Only editors and admins can publish articles directly', 403);
  }

  const articleData = {
    title,
    content,
    excerpt,
    category_id: category_id ? parseInt(category_id) : null,
    featured_image,
    meta_title,
    meta_description,
    meta_keywords,
    is_featured: req.user.role === 'admin' ? is_featured : false, // Only admin can set featured
    is_breaking: req.user.role === 'admin' ? is_breaking : false, // Only admin can set breaking
    status,
    scheduled_at: scheduled_at ? new Date(scheduled_at) : null,
    tags
  };

  const article = await Article.create(articleData, req.user.id);

  // Notify editors if article is ready for approval
  if (status === 'ready_to_post') {
    try {
      await emailService.sendApprovalNotification(article);
    } catch (error) {
      logger.error('Failed to send approval notification:', error);
    }
  }

  // Emit socket event for live blog
  if (req.app.get('io')) {
    req.app.get('io').emit('article-created', {
      article: article.toSummaryObject(),
      author: req.user
    });
  }

  res.status(201).json({
    success: true,
    message: 'Article created successfully',
    data: {
      article: article.toPublicObject()
    }
  });
});

// Update article
const updateArticle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    title,
    content,
    excerpt,
    category_id,
    featured_image,
    meta_title,
    meta_description,
    meta_keywords,
    is_featured,
    is_breaking,
    status,
    scheduled_at,
    tags
  } = req.body;

  const article = await Article.findById(parseInt(id));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  // Check if user can edit this article
  if (!article.canEdit(req.user.id, req.user.role)) {
    throw new AppError('Insufficient permissions to edit this article', 403);
  }

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (excerpt !== undefined) updates.excerpt = excerpt;
  if (category_id !== undefined) updates.category_id = category_id ? parseInt(category_id) : null;
  if (featured_image !== undefined) updates.featured_image = featured_image;
  if (meta_title !== undefined) updates.meta_title = meta_title;
  if (meta_description !== undefined) updates.meta_description = meta_description;
  if (meta_keywords !== undefined) updates.meta_keywords = meta_keywords;
  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at ? new Date(scheduled_at) : null;
  if (tags !== undefined) updates.tags = tags;

  // Only admin and editors can change these fields
  if (['admin', 'editor'].includes(req.user.role)) {
    if (status !== undefined) updates.status = status;
    if (is_featured !== undefined) updates.is_featured = is_featured;
    if (is_breaking !== undefined) updates.is_breaking = is_breaking;
  }

  // Journalists can only set status to ready_to_post or draft
  if (req.user.role === 'journalist' && status !== undefined) {
    if (!['draft', 'ready_to_post'].includes(status)) {
      throw new AppError('Journalists can only set status to draft or ready for approval', 403);
    }
    updates.status = status;
  }

  await article.update(updates, req.user.id);

  // Notify editors if article is ready for approval
  if (updates.status === 'ready_to_post') {
    try {
      await emailService.sendApprovalNotification(article);
    } catch (error) {
      logger.error('Failed to send approval notification:', error);
    }
  }

  // Emit socket event for live blog
  if (req.app.get('io')) {
    req.app.get('io').to(`article-${article.id}`).emit('article-updated', {
      article: article.toSummaryObject()
    });
  }

  res.json({
    success: true,
    message: 'Article updated successfully',
    data: {
      article: article.toPublicObject()
    }
  });
});

// Delete article
const deleteArticle = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const article = await Article.findById(parseInt(id));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  // Check permissions - only admin and editors can delete, or journalists can delete their own drafts
  if (req.user.role === 'journalist') {
    if (article.author_id !== req.user.id || article.status !== 'draft') {
      throw new AppError('Journalists can only delete their own draft articles', 403);
    }
  } else if (!['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Insufficient permissions to delete articles', 403);
  }

  await article.delete();

  res.json({
    success: true,
    message: 'Article deleted successfully'
  });
});

// Approve article (editors only)
const approveArticle = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Only editors and admins can approve articles', 403);
  }

  const article = await Article.findById(parseInt(id));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  if (article.status !== 'ready_to_post') {
    throw new AppError('Article is not ready for approval', 400);
  }

  await article.approve(req.user.id);

  // Notify author
  try {
    const author = await User.findById(article.author_id);
    if (author) {
      await emailService.sendApprovalConfirmation(author.email, article);
    }
  } catch (error) {
    logger.error('Failed to send approval confirmation:', error);
  }

  // Emit socket event for live blog
  if (req.app.get('io')) {
    req.app.get('io').emit('article-published', {
      article: article.toSummaryObject()
    });
  }

  res.json({
    success: true,
    message: 'Article approved and published successfully',
    data: {
      article: article.toPublicObject()
    }
  });
});

// Get featured articles
const getFeaturedArticles = asyncHandler(async (req, res) => {
  const { limit = 5 } = req.query;
  
  const articles = await Article.getFeatured(parseInt(limit));

  res.json({
    success: true,
    data: {
      articles: articles.map(article => article.toSummaryObject())
    }
  });
});

// Get breaking news
const getBreakingNews = asyncHandler(async (req, res) => {
  const { limit = 5 } = req.query;
  
  const articles = await Article.getBreaking(parseInt(limit));

  res.json({
    success: true,
    data: {
      articles: articles.map(article => article.toSummaryObject())
    }
  });
});

// Get popular articles
const getPopularArticles = asyncHandler(async (req, res) => {
  const { limit = 10, days = 7 } = req.query;
  
  const articles = await Article.getPopular(parseInt(limit), parseInt(days));

  res.json({
    success: true,
    data: {
      articles: articles.map(article => article.toSummaryObject())
    }
  });
});

// Get articles by category
const getArticlesByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const result = await Article.findByCategory(
    parseInt(categoryId),
    parseInt(page),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      articles: result.articles.map(article => article.toSummaryObject()),
      pagination: result.pagination
    }
  });
});

// Get pending articles (for editors)
const getPendingArticles = asyncHandler(async (req, res) => {
  if (!['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Only editors and admins can view pending articles', 403);
  }

  const { page = 1, limit = 10 } = req.query;

  const result = await Article.getPendingApproval(parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      articles: result.articles,
      pagination: result.pagination
    }
  });
});

// Get scheduled articles
const getScheduledArticles = asyncHandler(async (req, res) => {
  if (!['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Only editors and admins can view scheduled articles', 403);
  }

  const { page = 1, limit = 10 } = req.query;

  const result = await Article.getScheduled(parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      articles: result.articles,
      pagination: result.pagination
    }
  });
});

// Like article
const likeArticle = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const article = await Article.findById(parseInt(id));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  if (article.status !== 'published') {
    throw new AppError('Cannot like unpublished article', 400);
  }

  await article.incrementLikes();

  res.json({
    success: true,
    message: 'Article liked successfully',
    data: {
      likes: article.likes
    }
  });
});

// Get article analytics
const getArticleAnalytics = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { days = 30 } = req.query;

  const article = await Article.findById(parseInt(id));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  // Check permissions
  if (req.user.role === 'journalist' && article.author_id !== req.user.id) {
    throw new AppError('Journalists can only view analytics for their own articles', 403);
  }

  if (!['admin', 'editor', 'journalist'].includes(req.user.role)) {
    throw new AppError('Insufficient permissions to view analytics', 403);
  }

  const analytics = await article.getAnalyticsSummary(parseInt(days));

  res.json({
    success: true,
    data: {
      analytics
    }
  });
});

// Get article comments
const getArticleComments = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 10, status = 'approved' } = req.query;

  const article = await Article.findById(parseInt(id));
  if (!article) {
    throw new AppError('Article not found', 404);
  }

  // Only show approved comments to public, all comments to editors/admins
  const commentStatus = ['admin', 'editor'].includes(req.user?.role) ? 
    (status || 'approved') : 'approved';

  const result = await article.getComments(
    parseInt(page),
    parseInt(limit),
    commentStatus
  );

  res.json({
    success: true,
    data: {
      comments: result.comments,
      pagination: result.pagination
    }
  });
});

module.exports = {
  getArticles,
  getArticlesAdmin,
  getArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  approveArticle,
  getFeaturedArticles,
  getBreakingNews,
  getPopularArticles,
  getArticlesByCategory,
  getPendingArticles,
  getScheduledArticles,
  likeArticle,
  getArticleAnalytics,
  getArticleComments
};