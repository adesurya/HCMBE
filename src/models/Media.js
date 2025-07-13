// src/models/Media.js
const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class Media {
  constructor(data) {
    this.id = data?.id;
    this.filename = data?.filename;
    this.original_name = data?.original_name;
    this.mime_type = data?.mime_type;
    this.size = data?.size;
    this.width = data?.width;
    this.height = data?.height;
    this.path = data?.path;
    this.url = data?.url;
    this.cdn_url = data?.cdn_url;
    this.alt_text = data?.alt_text;
    this.caption = data?.caption;
    this.uploaded_by = data?.uploaded_by;
    this.is_optimized = data?.is_optimized ?? false;
    this.compression_ratio = data?.compression_ratio;
    this.created_at = data?.created_at;
    this.updated_at = data?.updated_at;
  }

  // Create new media record
  static async create(mediaData) {
    const {
      filename,
      original_name,
      mime_type,
      size,
      width,
      height,
      path,
      url,
      cdn_url,
      alt_text,
      caption,
      uploaded_by,
      is_optimized = false,
      compression_ratio
    } = mediaData;

    const [result] = await db.execute(
      `INSERT INTO media (
        filename, original_name, mime_type, size, width, height,
        path, url, cdn_url, alt_text, caption, uploaded_by,
        is_optimized, compression_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        filename, original_name, mime_type, size, width, height,
        path, url, cdn_url, alt_text, caption, uploaded_by,
        is_optimized, compression_ratio
      ]
    );

    const media = await Media.findById(result.insertId);
    return media;
  }

  // Find media by ID
  static async findById(id) {
    const [rows] = await db.execute(
      `SELECT m.*, u.username as uploaded_by_name
       FROM media m
       LEFT JOIN users u ON m.uploaded_by = u.id
       WHERE m.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    const media = new Media(rows[0]);
    media.uploaded_by_name = rows[0].uploaded_by_name;
    return media;
  }

  // Find all media with pagination and filters
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      uploaded_by = null,
      mime_type = null,
      search = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (uploaded_by) {
      conditions.push('m.uploaded_by = ?');
      params.push(uploaded_by);
    }

    if (mime_type) {
      conditions.push('m.mime_type LIKE ?');
      params.push(`${mime_type}%`);
    }

    if (search) {
      conditions.push('(m.original_name LIKE ? OR m.alt_text LIKE ? OR m.caption LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT m.*, u.username as uploaded_by_name
      FROM media m
      LEFT JOIN users u ON m.uploaded_by = u.id
      ${whereClause}
      ORDER BY m.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM media m
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    const media = rows.map(row => {
      const mediaItem = new Media(row);
      mediaItem.uploaded_by_name = row.uploaded_by_name;
      return mediaItem;
    });

    return {
      media,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      }
    };
  }

  // Update media metadata
  async update(updates) {
    const allowedUpdates = ['alt_text', 'caption', 'is_optimized', 'compression_ratio'];
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
      `UPDATE media SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Refresh media data
    const updatedMedia = await Media.findById(this.id);
    Object.assign(this, updatedMedia);

    return this;
  }

  // Delete media
  async delete() {
    await db.execute('DELETE FROM media WHERE id = ?', [this.id]);
    return this;
  }

  // Get media usage in articles
  async getUsage() {
    const [rows] = await db.execute(
      `SELECT a.id, a.title, a.slug
       FROM articles a
       WHERE a.featured_image = ? OR a.content LIKE ?`,
      [this.url, `%${this.url}%`]
    );

    return rows;
  }

  // Get media statistics
  static async getStatistics(uploadedBy = null) {
    let query = `
      SELECT 
        COUNT(*) as total_files,
        SUM(size) as total_size,
        AVG(size) as avg_size,
        COUNT(CASE WHEN mime_type LIKE 'image%' THEN 1 END) as image_count,
        COUNT(CASE WHEN mime_type LIKE 'video%' THEN 1 END) as video_count,
        COUNT(CASE WHEN mime_type LIKE 'audio%' THEN 1 END) as audio_count,
        COUNT(CASE WHEN mime_type LIKE 'application%' THEN 1 END) as document_count,
        AVG(compression_ratio) as avg_compression,
        COUNT(CASE WHEN is_optimized = 1 THEN 1 END) as optimized_count
      FROM media
    `;

    const params = [];

    if (uploadedBy) {
      query += ' WHERE uploaded_by = ?';
      params.push(uploadedBy);
    }

    const [rows] = await db.execute(query, params);
    return rows[0];
  }

  // Convert to public object (safe for API responses)
  toPublicObject() {
    return {
      id: this.id,
      filename: this.filename,
      original_name: this.original_name,
      mime_type: this.mime_type,
      size: this.size,
      width: this.width,
      height: this.height,
      url: this.url,
      cdn_url: this.cdn_url,
      alt_text: this.alt_text,
      caption: this.caption,
      is_optimized: this.is_optimized,
      compression_ratio: this.compression_ratio,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = Media;