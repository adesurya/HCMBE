// src/controllers/analyticsController.js
const Analytics = require('../models/Analytics');
const analyticsService = require('../services/analyticsService');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../../scripts/baksrc/utils/logger');

// Get analytics dashboard
const getDashboard = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const daysInt = parseInt(days);

  const dashboard = await analyticsService.getDashboardData(daysInt, req.user);

  res.json({
    success: true,
    data: dashboard
  });
});

// Get top articles
const getTopArticles = asyncHandler(async (req, res) => {
  const { 
    days = 7, 
    limit = 10, 
    metric = 'views' 
  } = req.query;

  // Journalists can only see their own articles
  const authorId = req.user.role === 'journalist' ? req.user.id : null;

  const topArticles = await analyticsService.getTopArticles(
    parseInt(limit),
    parseInt(days),
    metric,
    authorId
  );

  res.json({
    success: true,
    data: {
      articles: topArticles
    }
  });
});

// Get traffic statistics
const getTrafficStats = asyncHandler(async (req, res) => {
  const { 
    days = 30,
    groupBy = 'day' // day, hour, month
  } = req.query;

  const trafficStats = await analyticsService.getTrafficStats(
    parseInt(days),
    groupBy
  );

  res.json({
    success: true,
    data: {
      traffic: trafficStats
    }
  });
});

// Get user statistics
const getUserStats = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;

  // Only admin and editors can see user stats
  if (!['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Insufficient permissions to view user statistics', 403);
  }

  const userStats = await analyticsService.getUserStats(parseInt(days));

  res.json({
    success: true,
    data: {
      users: userStats
    }
  });
});

// Get article analytics
const getArticleAnalytics = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { days = 30 } = req.query;

  // Check if user can access this article's analytics
  if (req.user.role === 'journalist') {
    const Article = require('../models/Article');
    const article = await Article.findById(parseInt(id));
    
    if (!article || article.author_id !== req.user.id) {
      throw new AppError('You can only view analytics for your own articles', 403);
    }
  }

  const analytics = await analyticsService.getArticleAnalytics(
    parseInt(id),
    parseInt(days)
  );

  res.json({
    success: true,
    data: {
      analytics
    }
  });
});

// Get real-time analytics
const getRealTimeAnalytics = asyncHandler(async (req, res) => {
  const realTimeData = await analyticsService.getRealTimeData();

  res.json({
    success: true,
    data: realTimeData
  });
});

// Get device statistics
const getDeviceStats = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;

  const deviceStats = await analyticsService.getDeviceStats(parseInt(days));

  res.json({
    success: true,
    data: {
      devices: deviceStats
    }
  });
});

// Get browser statistics
const getBrowserStats = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;

  const browserStats = await analyticsService.getBrowserStats(parseInt(days));

  res.json({
    success: true,
    data: {
      browsers: browserStats
    }
  });
});

// Get geographic statistics
const getGeographicStats = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;

  const geoStats = await analyticsService.getGeographicStats(parseInt(days));

  res.json({
    success: true,
    data: {
      geographic: geoStats
    }
  });
});

// Get referrer statistics
const getReferrerStats = asyncHandler(async (req, res) => {
  const { days = 30, limit = 20 } = req.query;

  const referrerStats = await analyticsService.getReferrerStats(
    parseInt(days),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      referrers: referrerStats
    }
  });
});

// Export analytics data
const exportAnalytics = asyncHandler(async (req, res) => {
  const { 
    format = 'csv',
    days = 30,
    type = 'overview' // overview, articles, traffic, users
  } = req.query;

  // Only admin and editors can export
  if (!['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Insufficient permissions to export analytics', 403);
  }

  const exportData = await analyticsService.exportAnalytics(
    type,
    parseInt(days),
    format,
    req.user.role === 'journalist' ? req.user.id : null
  );

  // Set appropriate headers for file download
  const filename = `analytics_${type}_${days}days_${Date.now()}.${format}`;
  
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');

  res.send(exportData);
});

// Get search analytics
const getSearchAnalytics = asyncHandler(async (req, res) => {
  const { days = 30, limit = 20 } = req.query;

  const searchAnalytics = await analyticsService.getSearchAnalytics(
    parseInt(days),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      searches: searchAnalytics
    }
  });
});

module.exports = {
  getDashboard,
  getTopArticles,
  getTrafficStats,
  getUserStats,
  getArticleAnalytics,
  getRealTimeAnalytics,
  getDeviceStats,
  getBrowserStats,
  getGeographicStats,
  getReferrerStats,
  exportAnalytics,
  getSearchAnalytics
};