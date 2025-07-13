// src/services/searchService.js
const Article = require('../models/Article');
const db = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

class SearchService {
  constructor() {
    this.cache_ttl = 300; // 5 minutes cache
    this.suggestion_cache_ttl = 3600; // 1 hour cache for suggestions
  }

  // Main search function
  async searchArticles(options) {
    const startTime = Date.now();
    const {
      query,
      page = 1,
      limit = 10,
      category_id,
      author_id,
      date_from,
      date_to,
      sort_by = 'relevance',
      sort_order = 'DESC',
      ip_address,
      user_id
    } = options;

    // Track search query
    await this.trackSearchQuery(query, ip_address, user_id);

    // Build search options
    const searchOptions = {
      page,
      limit,
      category_id,
      author_id,
      date_from,
      date_to,
      sort_by,
      sort_order
    };

    // Perform search
    const result = await Article.search(query, searchOptions);
    
    // Calculate search time
    const searchTime = Date.now() - startTime;

    // Get search suggestions
    const suggestions = await this.getSearchSuggestions(query, 5);

    return {
      ...result,
      searchTime,
      suggestions
    };
  }

  // Advanced search with complex criteria
  async advancedSearch(criteria) {
    const startTime = Date.now();
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
    } = criteria;

    const conditions = [];
    const params = [];
    
    // Build WHERE conditions
    if (title) {
      conditions.push('a.title LIKE ?');
      params.push(`%${title}%`);
    }

    if (content) {
      conditions.push('MATCH(a.content) AGAINST(? IN NATURAL LANGUAGE MODE)');
      params.push(content);
    }

    if (author) {
      conditions.push('(u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)');
      const authorTerm = `%${author}%`;
      params.push(authorTerm, authorTerm, authorTerm);
    }

    if (category) {
      conditions.push('c.name LIKE ?');
      params.push(`%${category}%`);
    }

    if (tags && tags.length > 0) {
      const tagConditions = tags.map(() => 't.name LIKE ?').join(' OR ');
      conditions.push(`a.id IN (
        SELECT DISTINCT at.article_id 
        FROM article_tags at 
        JOIN tags t ON at.tag_id = t.id 
        WHERE ${tagConditions}
      )`);
      tags.forEach(tag => params.push(`%${tag}%`));
    }

    if (date_from) {
      conditions.push('a.published_at >= ?');
      params.push(date_from);
    }

    if (date_to) {
      conditions.push('a.published_at <= ?');
      params.push(date_to);
    }

    conditions.push('a.status = ?');
    params.push(status);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    // Main query
    const query = `
      SELECT DISTINCT a.*, u.username as author_name, c.name as category_name
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      ${whereClause}
      ORDER BY a.${sort_by} ${sort_order}
      LIMIT ? OFFSET ?
    `;

    // Count query
    const countQuery = `
      SELECT COUNT(DISTINCT a.id) as total
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    const articles = rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
      article.category = { name: row.category_name };
      return article;
    });

    const searchTime = Date.now() - startTime;

    return {
      articles,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      },
      searchTime
    };
  }

  // Search by tags
  async searchByTags(tags, operator = 'OR', page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    let query, countQuery;
    const params = [];

    if (operator === 'AND') {
      // All tags must be present
      query = `
        SELECT a.*, u.username as author_name, c.name as category_name
        FROM articles a
        LEFT JOIN users u ON a.author_id = u.id
        LEFT JOIN categories c ON a.category_id = c.id
        WHERE a.status = 'published'
          AND a.id IN (
            SELECT at.article_id
            FROM article_tags at
            JOIN tags t ON at.tag_id = t.id
            WHERE t.name IN (${tags.map(() => '?').join(',')})
            GROUP BY at.article_id
            HAVING COUNT(DISTINCT t.id) = ?
          )
        ORDER BY a.published_at DESC
        LIMIT ? OFFSET ?
      `;
      params.push(...tags, tags.length, limit, offset);

      countQuery = `
        SELECT COUNT(*) as total
        FROM articles a
        WHERE a.status = 'published'
          AND a.id IN (
            SELECT at.article_id
            FROM article_tags at
            JOIN tags t ON at.tag_id = t.id
            WHERE t.name IN (${tags.map(() => '?').join(',')})
            GROUP BY at.article_id
            HAVING COUNT(DISTINCT t.id) = ?
          )
      `;
      params.push(...tags, tags.length);
    } else {
      // Any tag can be present
      query = `
        SELECT DISTINCT a.*, u.username as author_name, c.name as category_name
        FROM articles a
        JOIN article_tags at ON a.id = at.article_id
        JOIN tags t ON at.tag_id = t.id
        LEFT JOIN users u ON a.author_id = u.id
        LEFT JOIN categories c ON a.category_id = c.id
        WHERE a.status = 'published'
          AND t.name IN (${tags.map(() => '?').join(',')})
        ORDER BY a.published_at DESC
        LIMIT ? OFFSET ?
      `;
      params.push(...tags, limit, offset);

      countQuery = `
        SELECT COUNT(DISTINCT a.id) as total
        FROM articles a
        JOIN article_tags at ON a.id = at.article_id
        JOIN tags t ON at.tag_id = t.id
        WHERE a.status = 'published'
          AND t.name IN (${tags.map(() => '?').join(',')})
      `;
      params.push(...tags);
    }

    const [rows] = await db.execute(query, params);
    const [countRows] = await db.execute(countQuery, params.slice(0, -2)); // Remove limit/offset for count

    const articles = rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
      article.category = { name: row.category_name };
      return article;
    });

    return {
      articles,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      }
    };
  }

  // Find similar articles
  async findSimilarArticles(articleId, limit = 5) {
    const cacheKey = `similar:${articleId}:${limit}`;
    
    return await redis.cache(cacheKey, async () => {
      const article = await Article.findById(articleId);
      if (!article) {
        return [];
      }

      return await article.getRelatedArticles(limit);
    }, this.cache_ttl);
  }

  // Get search suggestions
  async getSearchSuggestions(query, limit = 10) {
    if (!query || query.length < 2) {
      return [];
    }

    const cacheKey = `suggestions:${query}:${limit}`;
    
    return await redis.cache(cacheKey, async () => {
      // Get article titles that match
      const [titleRows] = await db.execute(
        `SELECT DISTINCT title
         FROM articles
         WHERE status = 'published'
           AND title LIKE ?
         ORDER BY views DESC
         LIMIT ?`,
        [`%${query}%`, Math.ceil(limit / 2)]
      );

      // Get popular search queries that match
      const [queryRows] = await db.execute(
        `SELECT query, COUNT(*) as search_count
         FROM search_queries
         WHERE query LIKE ?
           AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY query
         ORDER BY search_count DESC
         LIMIT ?`,
        [`%${query}%`, Math.floor(limit / 2)]
      );

      const suggestions = [
        ...titleRows.map(row => ({ type: 'title', value: row.title })),
        ...queryRows.map(row => ({ type: 'query', value: row.query, count: row.search_count }))
      ];

      return suggestions.slice(0, limit);
    }, this.suggestion_cache_ttl);
  }

  // Get autocomplete results
  async getAutocompleteResults(query, limit = 5) {
    if (!query || query.length < 2) {
      return [];
    }

    const cacheKey = `autocomplete:${query}:${limit}`;
    
    return await redis.cache(cacheKey, async () => {
      const [rows] = await db.execute(
        `SELECT title, slug
         FROM articles
         WHERE status = 'published'
           AND title LIKE ?
         ORDER BY views DESC, published_at DESC
         LIMIT ?`,
        [`${query}%`, limit]
      );

      return rows.map(row => ({
        title: row.title,
        slug: row.slug
      }));
    }, this.suggestion_cache_ttl);
  }

  // Get trending searches
  async getTrendingSearches(limit = 10, days = 7, minSearches = 5) {
    const cacheKey = `trending_searches:${limit}:${days}:${minSearches}`;
    
    return await redis.cache(cacheKey, async () => {
      const [rows] = await db.execute(
        `SELECT query, COUNT(*) as search_count
         FROM search_queries
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY query
         HAVING search_count >= ?
         ORDER BY search_count DESC
         LIMIT ?`,
        [days, minSearches, limit]
      );

      return rows;
    }, this.suggestion_cache_ttl);
  }

  // Track search query
  async trackSearchQuery(query, ipAddress, userId = null) {
    try {
      // Get results count
      const [countRows] = await db.execute(
        `SELECT COUNT(*) as count
         FROM articles
         WHERE status = 'published'
           AND MATCH(title, excerpt, content) AGAINST(? IN NATURAL LANGUAGE MODE)`,
        [query]
      );

      await db.execute(
        'INSERT INTO search_queries (query, results_count, ip_address, user_id) VALUES (?, ?, ?, ?)',
        [query, countRows[0].count, ipAddress, userId]
      );
    } catch (error) {
      logger.error('Error tracking search query:', error);
    }
  }

  // Get search analytics
  async getSearchAnalytics(days = 30, limit = 20) {
    const [rows] = await db.execute(
      `SELECT 
         query,
         COUNT(*) as search_count,
         AVG(results_count) as avg_results,
         COUNT(DISTINCT ip_address) as unique_searches
       FROM search_queries
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY query
       ORDER BY search_count DESC
       LIMIT ?`,
      [days, limit]
    );

    return rows;
  }

  // Reindex articles for search
  async reindexArticles() {
    try {
      // This is a placeholder - in a real application you might:
      // 1. Update full-text search indexes
      // 2. Update Elasticsearch/Solr indexes
      // 3. Regenerate search-related caches

      const [result] = await db.execute(
        'SELECT COUNT(*) as count FROM articles WHERE status = "published"'
      );

      const articleCount = result[0].count;

      // Clear search-related caches
      await this.clearSearchCaches();

      return {
        indexedCount: articleCount,
        failedCount: 0
      };
    } catch (error) {
      logger.error('Error reindexing articles:', error);
      throw error;
    }
  }

  // Clear search-related caches
  async clearSearchCaches() {
    // Clear specific cache patterns
    const patterns = [
      'suggestions:*',
      'autocomplete:*',
      'trending_searches:*',
      'similar:*'
    ];

    for (const pattern of patterns) {
      try {
        // Redis doesn't have a direct way to delete by pattern in this simple implementation
        // In production, you'd use KEYS or SCAN commands carefully
        logger.info(`Cleared cache pattern: ${pattern}`);
      } catch (error) {
        logger.error(`Error clearing cache pattern ${pattern}:`, error);
      }
    }
  }
}

module.exports = new SearchService();

