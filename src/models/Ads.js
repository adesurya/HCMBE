// src/models/Ads.js
const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class Ads {
  constructor(data) {
    this.id = data?.id;
    this.title = data?.title;
    this.type = data?.type;
    this.position = data?.position;
    this.content = data?.content;
    this.image_url = data?.image_url;
    this.link_url = data?.link_url;
    this.target_blank = data?.target_blank ?? true;
    this.width = data?.width;
    this.height = data?.height;
    this.is_active = data?.is_active ?? true;
    this.start_date = data?.start_date;
    this.end_date = data?.end_date;
    this.impressions = data?.impressions || 0;
    this.clicks = data?.clicks || 0;
    this.created_by = data?.created_by;
    this.created_at = data?.created_at;
    this.updated_at = data?.updated_at;
  }

  // Create new ad
  static async create(adData, createdBy) {
    const {
      title,
      type,
      position,
      content,
      image_url,
      link_url,
      target_blank = true,
      width,
      height,
      is_active = true,
      start_date,
      end_date
    } = adData;

    const [result] = await db.execute(
      `INSERT INTO ads (
        title, type, position, content, image_url, link_url, target_blank,
        width, height, is_active, start_date, end_date, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, type, position, content, image_url, link_url, target_blank,
        width, height, is_active, start_date, end_date, createdBy
      ]
    );

    const ad = await Ads.findById(result.insertId);
    return ad;
  }

  // Find ad by ID
  static async findById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM ads WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    return new Ads(rows[0]);
  }

  // Find all ads with pagination and filters
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 10,
      type = null,
      position = null,
      is_active = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    if (position) {
      conditions.push('position = ?');
      params.push(position);
    }

    if (is_active !== null) {
      conditions.push('is_active = ?');
      params.push(is_active);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT a.*, u.username as created_by_name
      FROM ads a
      LEFT JOIN users u ON a.created_by = u.id
      ${whereClause}
      ORDER BY a.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM ads a
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    const ads = rows.map(row => {
      const ad = new Ads(row);
      ad.created_by_name = row.created_by_name;
      return ad;
    });

    const total = countRows[0].total;

    return {
      ads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Find ads by position (for public display)
  static async findByPosition(position, activeOnly = true) {
    let query = 'SELECT * FROM ads WHERE position = ?';
    const params = [position];

    if (activeOnly) {
      query += ' AND is_active = true';
      query += ' AND (start_date IS NULL OR start_date <= NOW())';
      query += ' AND (end_date IS NULL OR end_date >= NOW())';
    }

    query += ' ORDER BY created_at ASC';

    const [rows] = await db.execute(query, params);
    return rows.map(row => new Ads(row));
  }

  // Update ad
  async update(updates) {
    const allowedUpdates = [
      'title', 'type', 'position', 'content', 'image_url', 'link_url',
      'target_blank', 'width', 'height', 'is_active', 'start_date', 'end_date'
    ];

    const updateFields = [];
    const updateValues = [];

    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key) && updates[key] !== undefined) {
        updateFields.push(`${key} = ?`);
        updateValues.push(updates[key]);
      }
    });

    if (updateFields.length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    updateValues.push(this.id);

    await db.execute(
      `UPDATE ads SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Refresh ad data
    const updatedAd = await Ads.findById(this.id);
    Object.assign(this, updatedAd);

    return this;
  }

  // Delete ad
  async delete() {
    await db.execute('DELETE FROM ads WHERE id = ?', [this.id]);
    return this;
  }

  // Increment impressions
  async incrementImpressions() {
    await db.execute(
      'UPDATE ads SET impressions = impressions + 1 WHERE id = ?',
      [this.id]
    );

    this.impressions = (this.impressions || 0) + 1;
    return this;
  }

  // Increment clicks
  async incrementClicks() {
    await db.execute(
      'UPDATE ads SET clicks = clicks + 1 WHERE id = ?',
      [this.id]
    );

    this.clicks = (this.clicks || 0) + 1;
    return this;
  }

  // Get ad statistics
  async getStatistics(days = 30) {
    // This is a simplified version - you might want to implement
    // more detailed analytics tracking in a separate analytics table
    const [rows] = await db.execute(
      `SELECT 
         impressions,
         clicks,
         CASE WHEN impressions > 0 THEN (clicks / impressions) * 100 ELSE 0 END as ctr
       FROM ads 
       WHERE id = ?`,
      [this.id]
    );

    return rows[0] || { impressions: 0, clicks: 0, ctr: 0 };
  }

  // Check if ad is currently active
  isCurrentlyActive() {
    if (!this.is_active) return false;

    const now = new Date();
    
    if (this.start_date && new Date(this.start_date) > now) {
      return false;
    }
    
    if (this.end_date && new Date(this.end_date) < now) {
      return false;
    }

    return true;
  }

  // Convert to public object (safe for API responses)
  toPublicObject() {
    return {
      id: this.id,
      title: this.title,
      type: this.type,
      position: this.position,
      content: this.content,
      image_url: this.image_url,
      link_url: this.link_url,
      target_blank: this.target_blank,
      width: this.width,
      height: this.height,
      is_active: this.is_active,
      start_date: this.start_date,
      end_date: this.end_date,
      impressions: this.impressions,
      clicks: this.clicks,
      created_at: this.created_at
    };
  }
}

module.exports = Ads;