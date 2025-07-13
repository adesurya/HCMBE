// src/utils/databaseHelper.js
const db = require('../config/database');
const logger = require('./logger');

class DatabaseHelper {
  constructor() {
    this.connection = db;
  }

  // Safe query execution with proper parameter handling
  async safeQuery(sql, params = []) {
    try {
      // Ensure all parameters are properly typed
      const safeParams = this.sanitizeParameters(params);
      
      logger.debug('Executing query:', { sql: sql.substring(0, 100) + '...', params: safeParams });
      
      const [rows] = await this.connection.execute(sql, safeParams);
      return rows;
    } catch (error) {
      logger.error('Database query error:', {
        error: error.message,
        sql: sql.substring(0, 200) + '...',
        params
      });
      throw error;
    }
  }

  // Sanitize and type-cast parameters
  sanitizeParameters(params) {
    return params.map(param => {
      if (param === null || param === undefined) {
        return null;
      }
      
      // Convert boolean to integer for MySQL compatibility
      if (typeof param === 'boolean') {
        return param ? 1 : 0;
      }
      
      // Ensure numbers are proper numbers
      if (typeof param === 'string' && !isNaN(param)) {
        const num = Number(param);
        return Number.isInteger(num) ? num : param;
      }
      
      return param;
    });
  }

  // Get articles with pagination - using safe query building
  async getArticlesForSitemap(page = 1, limit = 1000) {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query without placeholders for LIMIT/OFFSET due to MySQL2 issues
    const sql = `
      SELECT 
        a.slug, 
        a.title, 
        a.updated_at, 
        a.published_at,
        a.featured_image,
        a.meta_keywords,
        c.name as category_name,
        u.username as author_name
      FROM articles a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN users u ON a.author_id = u.id
      WHERE a.status = ?
      ORDER BY a.published_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `;
    
    return await this.safeQuery(sql, ['published']);
  }

  // Get recent news articles
  async getNewsArticles() {
    const sql = `
      SELECT 
        a.slug, 
        a.title, 
        a.published_at,
        a.featured_image,
        a.meta_keywords,
        c.name as category_name,
        u.username as author_name
      FROM articles a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN users u ON a.author_id = u.id
      WHERE a.status = ?
        AND a.published_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
      ORDER BY a.published_at DESC
      LIMIT 1000
    `;
    
    return await this.safeQuery(sql, ['published']);
  }

  // Get categories
  async getCategoriesForSitemap() {
    const sql = `
      SELECT slug, updated_at 
      FROM categories 
      WHERE is_active = ? 
      ORDER BY sort_order
    `;
    
    return await this.safeQuery(sql, [1]);
  }

  // Get popular tags
  async getTagsForSitemap(limit = 100) {
    const sql = `
      SELECT t.slug, t.updated_at, COUNT(at.article_id) as article_count
      FROM tags t
      JOIN article_tags at ON t.id = at.tag_id
      JOIN articles a ON at.article_id = a.id
      WHERE t.is_active = ? AND a.status = ?
      GROUP BY t.id, t.slug, t.updated_at
      ORDER BY article_count DESC
      LIMIT ${parseInt(limit)}
    `;
    
    return await this.safeQuery(sql, [1, 'published']);
  }

  // Count published articles
  async countPublishedArticles() {
    const sql = 'SELECT COUNT(*) as total FROM articles WHERE status = ?';
    const result = await this.safeQuery(sql, ['published']);
    return result[0].total;
  }

  // Count active categories
  async countActiveCategories() {
    const sql = 'SELECT COUNT(*) as total FROM categories WHERE is_active = ?';
    const result = await this.safeQuery(sql, [1]);
    return result[0].total;
  }

  // Count active tags
  async countActiveTags() {
    const sql = 'SELECT COUNT(*) as total FROM tags WHERE is_active = ?';
    const result = await this.safeQuery(sql, [1]);
    return result[0].total;
  }

  // Count recent news
  async countRecentNews() {
    const sql = `
      SELECT COUNT(*) as total FROM articles 
      WHERE status = ?
        AND published_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
    `;
    const result = await this.safeQuery(sql, ['published']);
    return result[0].total;
  }

  // Test database connection
  async testConnection() {
    try {
      const result = await this.safeQuery('SELECT 1 as test');
      return result.length > 0;
    } catch (error) {
      logger.error('Database connection test failed:', error);
      return false;
    }
  }

  // Check if table exists
  async tableExists(tableName) {
    try {
      const sql = 'SHOW TABLES LIKE ?';
      const result = await this.safeQuery(sql, [tableName]);
      return result.length > 0;
    } catch (error) {
      logger.error(`Error checking table ${tableName}:`, error);
      return false;
    }
  }

  // Get table columns
  async getTableColumns(tableName) {
    try {
      const sql = `DESCRIBE ${tableName}`;
      return await this.safeQuery(sql, []);
    } catch (error) {
      logger.error(`Error getting columns for ${tableName}:`, error);
      return [];
    }
  }

  // Alternative query method using query() instead of execute()
  async queryWithoutParams(sql) {
    try {
      logger.debug('Executing parameterless query:', sql.substring(0, 100) + '...');
      const [rows] = await this.connection.query(sql);
      return rows;
    } catch (error) {
      logger.error('Parameterless query error:', {
        error: error.message,
        sql: sql.substring(0, 200) + '...'
      });
      throw error;
    }
  }

  // Fallback method for articles if parameterized queries fail
  async getArticlesForSitemapFallback(page = 1, limit = 1000) {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const sql = `
      SELECT 
        a.slug, 
        a.title, 
        a.updated_at, 
        a.published_at,
        a.featured_image,
        a.meta_keywords,
        c.name as category_name,
        u.username as author_name
      FROM articles a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN users u ON a.author_id = u.id
      WHERE a.status = 'published'
      ORDER BY a.published_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `;
    
    return await this.queryWithoutParams(sql);
  }
}

module.exports = new DatabaseHelper();