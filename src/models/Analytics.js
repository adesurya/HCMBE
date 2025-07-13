// src/models/Analytics.js
const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class Analytics {
  constructor(data) {
    this.id = data?.id;
    this.article_id = data?.article_id;
    this.event_type = data?.event_type;
    this.ip_address = data?.ip_address;
    this.user_agent = data?.user_agent;
    this.referrer = data?.referrer;
    this.country = data?.country;
    this.city = data?.city;
    this.device_type = data?.device_type;
    this.browser = data?.browser;
    this.os = data?.os;
    this.view_duration = data?.view_duration;
    this.created_at = data?.created_at;
  }

  // Track an analytics event
  static async track(eventData) {
    const {
      article_id,
      event_type,
      ip_address,
      user_agent,
      referrer,
      country,
      city,
      device_type,
      browser,
      os,
      view_duration
    } = eventData;

    const [result] = await db.execute(
      `INSERT INTO analytics (
        article_id, event_type, ip_address, user_agent, referrer,
        country, city, device_type, browser, os, view_duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        article_id, event_type, ip_address, user_agent, referrer,
        country, city, device_type, browser, os, view_duration
      ]
    );

    return result.insertId;
  }

  // Get analytics data for an article
  static async getArticleAnalytics(articleId, days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) as total_events,
         COUNT(CASE WHEN event_type = 'view' THEN 1 END) as views,
         COUNT(CASE WHEN event_type = 'like' THEN 1 END) as likes,
         COUNT(CASE WHEN event_type = 'share' THEN 1 END) as shares,
         COUNT(CASE WHEN event_type = 'comment' THEN 1 END) as comments,
         COUNT(DISTINCT ip_address) as unique_visitors,
         AVG(CASE WHEN event_type = 'view' THEN view_duration END) as avg_duration
       FROM analytics 
       WHERE article_id = ? 
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [articleId, days]
    );

    return rows;
  }

  // Get top articles by views
  static async getTopArticles(limit = 10, days = 7, authorId = null) {
    let query = `
      SELECT 
        a.article_id,
        art.title,
        art.slug,
        COUNT(*) as total_views,
        COUNT(DISTINCT a.ip_address) as unique_views,
        AVG(a.view_duration) as avg_duration
      FROM analytics a
      JOIN articles art ON a.article_id = art.id
      WHERE a.event_type = 'view'
        AND a.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const params = [days];

    if (authorId) {
      query += ' AND art.author_id = ?';
      params.push(authorId);
    }

    query += `
      GROUP BY a.article_id, art.title, art.slug
      ORDER BY total_views DESC
      LIMIT ?
    `;

    params.push(limit);

    const [rows] = await db.execute(query, params);
    return rows;
  }

  // Get traffic statistics
  static async getTrafficStats(days = 30, groupBy = 'day') {
    let dateFormat;
    switch (groupBy) {
      case 'hour':
        dateFormat = '%Y-%m-%d %H:00:00';
        break;
      case 'month':
        dateFormat = '%Y-%m-01';
        break;
      default:
        dateFormat = '%Y-%m-%d';
    }

    const [rows] = await db.execute(
      `SELECT 
         DATE_FORMAT(created_at, ?) as period,
         COUNT(*) as total_events,
         COUNT(CASE WHEN event_type = 'view' THEN 1 END) as page_views,
         COUNT(DISTINCT ip_address) as unique_visitors,
         COUNT(DISTINCT article_id) as articles_viewed
       FROM analytics 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE_FORMAT(created_at, ?)
       ORDER BY period DESC`,
      [dateFormat, days, dateFormat]
    );

    return rows;
  }

  // Get device statistics
  static async getDeviceStats(days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         device_type,
         COUNT(*) as count,
         COUNT(*) * 100.0 / (SELECT COUNT(*) FROM analytics WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as percentage
       FROM analytics 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND device_type IS NOT NULL
       GROUP BY device_type
       ORDER BY count DESC`,
      [days, days]
    );

    return rows;
  }

  // Get browser statistics
  static async getBrowserStats(days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         browser,
         COUNT(*) as count,
         COUNT(*) * 100.0 / (SELECT COUNT(*) FROM analytics WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as percentage
       FROM analytics 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND browser IS NOT NULL
       GROUP BY browser
       ORDER BY count DESC
       LIMIT 10`,
      [days, days]
    );

    return rows;
  }

  // Get geographic statistics
  static async getGeographicStats(days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         country,
         city,
         COUNT(*) as count,
         COUNT(DISTINCT ip_address) as unique_visitors
       FROM analytics 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND country IS NOT NULL
       GROUP BY country, city
       ORDER BY count DESC
       LIMIT 20`,
      [days]
    );

    return rows;
  }

  // Get referrer statistics
  static async getReferrerStats(days = 30, limit = 20) {
    const [rows] = await db.execute(
      `SELECT 
         referrer,
         COUNT(*) as count,
         COUNT(DISTINCT ip_address) as unique_visitors
       FROM analytics 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND referrer IS NOT NULL
         AND referrer != ''
       GROUP BY referrer
       ORDER BY count DESC
       LIMIT ?`,
      [days, limit]
    );

    return rows;
  }

  // Get real-time analytics
  static async getRealTimeData() {
    const [activeUsers] = await db.execute(
      `SELECT COUNT(DISTINCT ip_address) as active_users
       FROM analytics 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
    );

    const [recentViews] = await db.execute(
      `SELECT 
         a.article_id,
         art.title,
         COUNT(*) as views
       FROM analytics a
       JOIN articles art ON a.article_id = art.id
       WHERE a.event_type = 'view'
         AND a.created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
       GROUP BY a.article_id, art.title
       ORDER BY views DESC
       LIMIT 10`
    );

    const [currentHourStats] = await db.execute(
      `SELECT 
         COUNT(*) as total_events,
         COUNT(CASE WHEN event_type = 'view' THEN 1 END) as page_views,
         COUNT(DISTINCT ip_address) as unique_visitors
       FROM analytics 
       WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00')`
    );

    return {
      active_users: activeUsers[0].active_users,
      recent_popular_articles: recentViews,
      current_hour_stats: currentHourStats[0]
    };
  }

  // Clean old analytics data
  static async cleanOldData(olderThanDays = 365) {
    const [result] = await db.execute(
      'DELETE FROM analytics WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [olderThanDays]
    );

    return result.affectedRows;
  }
}

module.exports = Analytics;