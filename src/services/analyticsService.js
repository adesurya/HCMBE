// src/services/analyticsService.js
const Analytics = require('../models/Analytics');
const Article = require('../models/Article');
const db = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

class AnalyticsService {
  constructor() {
    this.cache_ttl = 300; // 5 minutes cache
  }

  // Track a view event
  async trackView(articleId, req) {
    try {
      const eventData = {
        article_id: articleId,
        event_type: 'view',
        ip_address: this.getClientIP(req),
        user_agent: req.get('User-Agent'),
        referrer: req.get('Referer'),
        ...this.parseUserAgent(req.get('User-Agent'))
      };

      // Check if this is a unique view (within 1 hour)
      const cacheKey = `view:${articleId}:${eventData.ip_address}`;
      const hasViewed = await redis.exists(cacheKey);

      if (!hasViewed) {
        await Analytics.track(eventData);
        await redis.set(cacheKey, '1', 3600); // Cache for 1 hour
      }

      return true;
    } catch (error) {
      logger.error('Error tracking view:', error);
      return false;
    }
  }

  // Track other events (like, share, comment)
  async trackEvent(articleId, eventType, req, additionalData = {}) {
    try {
      const eventData = {
        article_id: articleId,
        event_type: eventType,
        ip_address: this.getClientIP(req),
        user_agent: req.get('User-Agent'),
        referrer: req.get('Referer'),
        ...this.parseUserAgent(req.get('User-Agent')),
        ...additionalData
      };

      await Analytics.track(eventData);
      return true;
    } catch (error) {
      logger.error(`Error tracking ${eventType}:`, error);
      return false;
    }
  }

  // Get dashboard data
  async getDashboardData(days = 30, user = null) {
    const cacheKey = `dashboard:${days}:${user?.role}:${user?.id}`;
    
    return await redis.cache(cacheKey, async () => {
      const data = {};

      // Get basic stats
      data.totalViews = await this.getTotalViews(days, user);
      data.totalArticles = await this.getTotalArticles(days, user);
      data.totalComments = await this.getTotalComments(days, user);
      data.uniqueVisitors = await this.getUniqueVisitors(days);

      // Get trend data
      data.viewsTrend = await this.getViewsTrend(days, user);
      data.popularArticles = await this.getTopArticles(10, days, 'views', user?.role === 'journalist' ? user.id : null);
      data.trafficSources = await this.getTrafficSources(days);
      data.deviceStats = await Analytics.getDeviceStats(days);

      return data;
    }, this.cache_ttl);
  }

  // Get total views
  async getTotalViews(days = 30, user = null) {
    let query = `
      SELECT COUNT(*) as total
      FROM analytics a
      WHERE a.event_type = 'view'
        AND a.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [days];

    if (user?.role === 'journalist') {
      query += ` AND a.article_id IN (
        SELECT id FROM articles WHERE author_id = ?
      )`;
      params.push(user.id);
    }

    const [rows] = await db.execute(query, params);
    return rows[0].total;
  }

  // Get total articles
  async getTotalArticles(days = 30, user = null) {
    let query = `
      SELECT COUNT(*) as total
      FROM articles
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [days];

    if (user?.role === 'journalist') {
      query += ' AND author_id = ?';
      params.push(user.id);
    }

    const [rows] = await db.execute(query, params);
    return rows[0].total;
  }

  // Get total comments
  async getTotalComments(days = 30, user = null) {
    let query = `
      SELECT COUNT(*) as total
      FROM comments c
      WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [days];

    if (user?.role === 'journalist') {
      query += ` AND c.article_id IN (
        SELECT id FROM articles WHERE author_id = ?
      )`;
      params.push(user.id);
    }

    const [rows] = await db.execute(query, params);
    return rows[0].total;
  }

  // Get unique visitors
  async getUniqueVisitors(days = 30) {
    const [rows] = await db.execute(
      `SELECT COUNT(DISTINCT ip_address) as total
       FROM analytics
       WHERE event_type = 'view'
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );
    return rows[0].total;
  }

  // Get views trend
  async getViewsTrend(days = 30, user = null) {
    let query = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as views
      FROM analytics a
      WHERE a.event_type = 'view'
        AND a.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [days];

    if (user?.role === 'journalist') {
      query += ` AND a.article_id IN (
        SELECT id FROM articles WHERE author_id = ?
      )`;
      params.push(user.id);
    }

    query += `
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    const [rows] = await db.execute(query, params);
    return rows;
  }

  // Get top articles
  async getTopArticles(limit = 10, days = 7, metric = 'views', authorId = null) {
    return await Analytics.getTopArticles(limit, days, authorId);
  }

  // Get traffic statistics
  async getTrafficStats(days = 30, groupBy = 'day') {
    return await Analytics.getTrafficStats(days, groupBy);
  }

  // Get user statistics
  async getUserStats(days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         COUNT(*) as total_users,
         COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) as new_users,
         COUNT(CASE WHEN role = 'journalist' THEN 1 END) as journalists,
         COUNT(CASE WHEN role = 'editor' THEN 1 END) as editors,
         COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_users
       FROM users`,
      [days]
    );

    return rows[0];
  }

  // Get article analytics
  async getArticleAnalytics(articleId, days = 30) {
    const cacheKey = `article_analytics:${articleId}:${days}`;
    
    return await redis.cache(cacheKey, async () => {
      const analytics = await Analytics.getArticleAnalytics(articleId, days);
      
      // Get total stats
      const [totalStats] = await db.execute(
        `SELECT 
           COUNT(*) as total_views,
           COUNT(DISTINCT ip_address) as unique_views,
           AVG(view_duration) as avg_duration
         FROM analytics
         WHERE article_id = ? AND event_type = 'view'`,
        [articleId]
      );

      return {
        daily_analytics: analytics,
        total_stats: totalStats[0] || { total_views: 0, unique_views: 0, avg_duration: 0 }
      };
    }, this.cache_ttl);
  }

  // Get real-time data
  async getRealTimeData() {
    return await Analytics.getRealTimeData();
  }

  // Get device statistics
  async getDeviceStats(days = 30) {
    return await Analytics.getDeviceStats(days);
  }

  // Get browser statistics
  async getBrowserStats(days = 30) {
    return await Analytics.getBrowserStats(days);
  }

  // Get geographic statistics
  async getGeographicStats(days = 30) {
    return await Analytics.getGeographicStats(days);
  }

  // Get referrer statistics
  async getReferrerStats(days = 30, limit = 20) {
    return await Analytics.getReferrerStats(days, limit);
  }

  // Get traffic sources
  async getTrafficSources(days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         CASE 
           WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
           WHEN referrer LIKE '%google%' THEN 'Google'
           WHEN referrer LIKE '%facebook%' THEN 'Facebook'
           WHEN referrer LIKE '%twitter%' THEN 'Twitter'
           WHEN referrer LIKE '%linkedin%' THEN 'LinkedIn'
           ELSE 'Other'
         END as source,
         COUNT(*) as visits
       FROM analytics
       WHERE event_type = 'view'
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY source
       ORDER BY visits DESC`,
      [days]
    );

    return rows;
  }

  // Get search analytics
  async getSearchAnalytics(days = 30, limit = 20) {
    const [rows] = await db.execute(
      `SELECT 
         query,
         COUNT(*) as search_count,
         AVG(results_count) as avg_results
       FROM search_queries
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY query
       ORDER BY search_count DESC
       LIMIT ?`,
      [days, limit]
    );

    return rows;
  }

  // Export analytics data
  async exportAnalytics(type, days, format, authorId = null) {
    let data = [];

    switch (type) {
      case 'overview':
        data = await this.getOverviewData(days, authorId);
        break;
      case 'articles':
        data = await this.getArticlesData(days, authorId);
        break;
      case 'traffic':
        data = await this.getTrafficData(days);
        break;
      case 'users':
        data = await this.getUsersData(days);
        break;
      default:
        throw new Error('Invalid export type');
    }

    if (format === 'csv') {
      return this.convertToCSV(data);
    }

    return JSON.stringify(data, null, 2);
  }

  // Get overview data for export
  async getOverviewData(days, authorId) {
    const [rows] = await db.execute(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) as total_events,
         COUNT(CASE WHEN event_type = 'view' THEN 1 END) as views,
         COUNT(DISTINCT ip_address) as unique_visitors
       FROM analytics
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ${authorId ? 'AND article_id IN (SELECT id FROM articles WHERE author_id = ?)' : ''}
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      authorId ? [days, authorId] : [days]
    );

    return rows;
  }

  // Get articles data for export
  async getArticlesData(days, authorId) {
    let query = `
      SELECT 
        a.title,
        a.published_at,
        COUNT(an.id) as views,
        COUNT(DISTINCT an.ip_address) as unique_views,
        AVG(an.view_duration) as avg_duration
      FROM articles a
      LEFT JOIN analytics an ON a.id = an.article_id AND an.event_type = 'view'
      WHERE a.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [days];

    if (authorId) {
      query += ' AND a.author_id = ?';
      params.push(authorId);
    }

    query += `
      GROUP BY a.id, a.title, a.published_at
      ORDER BY views DESC
    `;

    const [rows] = await db.execute(query, params);
    return rows;
  }

  // Get traffic data for export
  async getTrafficData(days) {
    return await this.getTrafficStats(days);
  }

  // Get users data for export
  async getUsersData(days) {
    const [rows] = await db.execute(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) as new_users,
         COUNT(CASE WHEN role = 'journalist' THEN 1 END) as new_journalists,
         COUNT(CASE WHEN role = 'editor' THEN 1 END) as new_editors
       FROM users
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [days]
    );

    return rows;
  }

  // Convert data to CSV format
  convertToCSV(data) {
    if (!data || data.length === 0) {
      return '';
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row =>
        headers.map(header => {
          const value = row[header];
          return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
        }).join(',')
      )
    ].join('\n');

    return csvContent;
  }

  // Parse user agent for device/browser info
  parseUserAgent(userAgent) {
    if (!userAgent) {
      return { device_type: 'unknown', browser: 'unknown', os: 'unknown' };
    }

    // Simple user agent parsing (you might want to use a proper library like ua-parser-js)
    const ua = userAgent.toLowerCase();
    
    let device_type = 'desktop';
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      device_type = 'mobile';
    } else if (ua.includes('tablet') || ua.includes('ipad')) {
      device_type = 'tablet';
    }

    let browser = 'unknown';
    if (ua.includes('chrome')) browser = 'Chrome';
    else if (ua.includes('firefox')) browser = 'Firefox';
    else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
    else if (ua.includes('edge')) browser = 'Edge';
    else if (ua.includes('opera')) browser = 'Opera';

    let os = 'unknown';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('mac')) os = 'macOS';
    else if (ua.includes('linux')) os = 'Linux';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

    return { device_type, browser, os };
  }

  // Get client IP address
  getClientIP(req) {
    return req.ip || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           '0.0.0.0';
  }

  // Clean old analytics data
  async cleanOldData(olderThanDays = 365) {
    try {
      const deletedRows = await Analytics.cleanOldData(olderThanDays);
      logger.info(`Cleaned ${deletedRows} old analytics records`);
      return deletedRows;
    } catch (error) {
      logger.error('Error cleaning old analytics data:', error);
      throw error;
    }
  }
}

module.exports = new AnalyticsService();
