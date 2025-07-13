// src/controllers/searchController.js
const searchService = require('../services/searchService');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Search articles
const searchArticles = asyncHandler(async (req, res) => {
  const {
    q: query,
    page = 1,
    limit = 10,
    category_id,
    author_id,
    date_from,
    date_to,
    sort_by = 'relevance', // relevance, date, popularity
    sort_order = 'DESC'
  } = req.query;

  if (!query || query.trim().length < 2) {
    throw new AppError('Search query must be at least 2 characters long', 400);
  }

  const searchOptions = {
    query: query.trim(),
    page: parseInt(page),
    limit: parseInt(limit),
    category_id: category_id ? parseInt(category_id) : null,
    author_id: author_id ? parseInt(author_id) : null,
    date_from: date_from ? new Date(date_from) : null,
    date_to: date_to ? new Date(date_to) : null,
    sort_by,
    sort_order: sort_order.toUpperCase(),
    ip_address: req.ip,
    user_id: req.user?.id || null
  };

  const result = await searchService.searchArticles(searchOptions);

  res.json({
    success: true,
    data: {
      query: query.trim(),
      articles: result.articles,
      pagination: result.pagination,
      search_time: result.searchTime,
      suggestions: result.suggestions
    }
  });
});

// Get search suggestions
const getSearchSuggestions = asyncHandler(async (req, res) => {
  const { q: query, limit = 10 } = req.query;

  if (!query || query.trim().length < 2) {
    return res.json({
      success: true,
      data: {
        suggestions: []
      }
    });
  }

  const suggestions = await searchService.getSearchSuggestions(
    query.trim(),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      suggestions
    }
  });
});

// Get trending searches
const getTrendingSearches = asyncHandler(async (req, res) => {
  const { 
    limit = 10, 
    days = 7,
    min_searches = 5 
  } = req.query;

  const trending = await searchService.getTrendingSearches(
    parseInt(limit),
    parseInt(days),
    parseInt(min_searches)
  );

  res.json({
    success: true,
    data: {
      trending_searches: trending
    }
  });
});

// Advanced search
const advancedSearch = asyncHandler(async (req, res) => {
  const {
    title,
    content,
    author,
    category,
    tags,
    date_from,
    date_to,
    status = 'published',
    page = 1,
    limit = 10,
    sort_by = 'published_at',
    sort_order = 'DESC'
  } = req.query;

  const searchCriteria = {
    title: title?.trim(),
    content: content?.trim(),
    author: author?.trim(),
    category: category?.trim(),
    tags: tags ? tags.split(',').map(tag => tag.trim()) : null,
    date_from: date_from ? new Date(date_from) : null,
    date_to: date_to ? new Date(date_to) : null,
    status,
    page: parseInt(page),
    limit: parseInt(limit),
    sort_by,
    sort_order: sort_order.toUpperCase()
  };

  const result = await searchService.advancedSearch(searchCriteria);

  res.json({
    success: true,
    data: {
      articles: result.articles,
      pagination: result.pagination,
      search_time: result.searchTime
    }
  });
});

// Search by tags
const searchByTags = asyncHandler(async (req, res) => {
  const {
    tags,
    page = 1,
    limit = 10,
    operator = 'OR' // OR, AND
  } = req.query;

  if (!tags) {
    throw new AppError('Tags parameter is required', 400);
  }

  const tagList = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tagList.length === 0) {
    throw new AppError('At least one valid tag is required', 400);
  }

  const result = await searchService.searchByTags(
    tagList,
    operator.toUpperCase(),
    parseInt(page),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      tags: tagList,
      operator,
      articles: result.articles,
      pagination: result.pagination
    }
  });
});

// Search similar articles
const searchSimilarArticles = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { limit = 5 } = req.query;

  const similarArticles = await searchService.findSimilarArticles(
    parseInt(id),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      similar_articles: similarArticles
    }
  });
});

// Search autocomplete
const searchAutocomplete = asyncHandler(async (req, res) => {
  const { q: query, limit = 5 } = req.query;

  if (!query || query.trim().length < 2) {
    return res.json({
      success: true,
      data: {
        suggestions: []
      }
    });
  }

  const suggestions = await searchService.getAutocompleteResults(
    query.trim(),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      suggestions
    }
  });
});

// Get search analytics (admin/editor only)
const getSearchAnalytics = asyncHandler(async (req, res) => {
  if (!['admin', 'editor'].includes(req.user.role)) {
    throw new AppError('Insufficient permissions to view search analytics', 403);
  }

  const {
    days = 30,
    limit = 20
  } = req.query;

  const analytics = await searchService.getSearchAnalytics(
    parseInt(days),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: {
      analytics
    }
  });
});

// Index articles for search (admin only)
const reindexArticles = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Only administrators can reindex articles', 403);
  }

  const result = await searchService.reindexArticles();

  res.json({
    success: true,
    message: 'Articles reindexed successfully',
    data: {
      indexed_count: result.indexedCount,
      failed_count: result.failedCount
    }
  });
});

module.exports = {
  searchArticles,
  getSearchSuggestions,
  getTrendingSearches,
  advancedSearch,
  searchByTags,
  searchSimilarArticles,
  searchAutocomplete,
  getSearchAnalytics,
  reindexArticles
};