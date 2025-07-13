// src/models/Tag.js
const db = require('../config/database');
const slugify = require('slugify');
const { AppError } = require('../middleware/errorHandler');

class Tag {
  constructor(data) {
    this.id = data?.id;
    this.name = data?.name;
    this.slug = data?.slug;
    this.description = data?.description;
    this.color = data?.color || '#3498db';
    this.is_active = data?.is_active ?? true;
    this.created_at = data?.created_at;
    this.updated_at = data?.updated_at;
  }

  // Generate unique slug
  static async generateSlug(name, excludeId = null) {
    let baseSlug = slugify(name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const [rows] = await db.execute(
        `SELECT id FROM tags WHERE slug = ?${excludeId ? ' AND id != ?' : ''}`,
        excludeId ? [slug, excludeId] : [slug]
      );

      if (rows.length === 0) {
        break;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  // Create new tag
  static async create(tagData) {
    const {
      name,
      description,
      color = '#3498db',
      is_active = true
    } = tagData;

    // Generate slug
    const slug = await Tag.generateSlug(name);

    const [result] = await db.execute(
      `INSERT INTO tags (name, slug, description, color, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [name, slug, description, color, is_active]
    );

    const tag = await Tag.findById(result.insertId);
    return tag;
  }

  // Find tag by ID
  static async findById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM tags WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    return new Tag(rows[0]);
  }

  // Find tag by slug
  static async findBySlug(slug) {
    const [rows] = await db.execute(
      'SELECT * FROM tags WHERE slug = ?',
      [slug]
    );

    if (rows.length === 0) {
      return null;
    }

    return new Tag(rows[0]);
  }

  // Find all tags with pagination and filters
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      is_active = null,
      search = null,
      sortBy = 'name',
      sortOrder = 'ASC'
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (is_active !== null) {
      conditions.push('is_active = ?');
      params.push(is_active);
    }

    if (search) {
      conditions.push('(name LIKE ? OR description LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT t.*, COUNT(at.article_id) as article_count
      FROM tags t
      LEFT JOIN article_tags at ON t.id = at.tag_id
      LEFT JOIN articles a ON at.article_id = a.id AND a.status = 'published'
      ${whereClause}
      GROUP BY t.id
      ORDER BY t.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM tags t
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    const tags = rows.map(row => {
      const tag = new Tag(row);
      tag.article_count = row.article_count;
      return tag;
    });

    const total = countRows[0].total;

    return {
      tags,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Get popular tags
  static async getPopular(limit = 20, days = 30) {
    const [rows] = await db.execute(
      `SELECT t.*, COUNT(at.article_id) as article_count
       FROM tags t
       JOIN article_tags at ON t.id = at.tag_id
       JOIN articles a ON at.article_id = a.id
       WHERE t.is_active = true 
         AND a.status = 'published'
         AND a.published_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY t.id
       ORDER BY article_count DESC, t.name ASC
       LIMIT ?`,
      [days, limit]
    );

    return rows.map(row => {
      const tag = new Tag(row);
      tag.article_count = row.article_count;
      return tag;
    });
  }

  // Update tag
  async update(updates) {
    const allowedUpdates = ['name', 'description', 'color', 'is_active'];
    const updateFields = [];
    const updateValues = [];

    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key) && updates[key] !== undefined) {
        updateFields.push(`${key} = ?`);
        updateValues.push(updates[key]);

        // Update slug if name is changed
        if (key === 'name') {
          updateFields.push('slug = ?');
          updateValues.push(Tag.generateSlug(updates[key], this.id));
        }
      }
    });

    if (updateFields.length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    updateValues.push(this.id);

    await db.execute(
      `UPDATE tags SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Refresh tag data
    const updatedTag = await Tag.findById(this.id);
    Object.assign(this, updatedTag);

    return this;
  }

  // Delete tag
  async delete() {
    // Remove tag associations first
    await db.execute('DELETE FROM article_tags WHERE tag_id = ?', [this.id]);
    // Delete the tag
    await db.execute('DELETE FROM tags WHERE id = ?', [this.id]);
    return this;
  }

  // Get tag articles
  async getArticles(page = 1, limit = 10, status = 'published', sortBy = 'published_at', sortOrder = 'DESC') {
    const offset = (page - 1) * limit;

    const [rows] = await db.execute(
      `SELECT a.*, u.username as author_name
       FROM articles a
       JOIN article_tags at ON a.id = at.article_id
       LEFT JOIN users u ON a.author_id = u.id
       WHERE at.tag_id = ? AND a.status = ?
       ORDER BY a.${sortBy} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [this.id, status, limit, offset]
    );

    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total
       FROM articles a
       JOIN article_tags at ON a.id = at.article_id
       WHERE at.tag_id = ? AND a.status = ?`,
      [this.id, status]
    );

    return {
      articles: rows,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      }
    };
  }

  // Get article count for this tag
  async getArticleCount(status = 'published') {
    const [rows] = await db.execute(
      `SELECT COUNT(*) as count
       FROM articles a
       JOIN article_tags at ON a.id = at.article_id
       WHERE at.tag_id = ? AND a.status = ?`,
      [this.id, status]
    );

    return rows[0].count;
  }

  // Merge tags
  static async merge(sourceTagId, targetTagId) {
    // Move all article associations from source to target
    await db.execute(
      `UPDATE IGNORE article_tags 
       SET tag_id = ? 
       WHERE tag_id = ?`,
      [targetTagId, sourceTagId]
    );

    // Remove any remaining duplicate associations
    await db.execute(
      'DELETE FROM article_tags WHERE tag_id = ?',
      [sourceTagId]
    );

    // Delete the source tag
    await db.execute('DELETE FROM tags WHERE id = ?', [sourceTagId]);

    return true;
  }

  // Get tag cloud data
  static async getTagCloud(limit = 50, minCount = 1) {
    const [rows] = await db.execute(
      `SELECT t.*, COUNT(at.article_id) as article_count
       FROM tags t
       JOIN article_tags at ON t.id = at.tag_id
       JOIN articles a ON at.article_id = a.id
       WHERE t.is_active = true AND a.status = 'published'
       GROUP BY t.id
       HAVING article_count >= ?
       ORDER BY article_count DESC, t.name ASC
       LIMIT ?`,
      [minCount, limit]
    );

    // Calculate relative sizes for tag cloud
    const maxCount = Math.max(...rows.map(row => row.article_count));
    const minCount_actual = Math.min(...rows.map(row => row.article_count));

    return rows.map(row => {
      const tag = new Tag(row);
      tag.article_count = row.article_count;
      
      // Calculate relative size (1-5 scale)
      const range = maxCount - minCount_actual;
      const normalizedCount = range > 0 ? (row.article_count - minCount_actual) / range : 0;
      tag.size = Math.ceil(normalizedCount * 4) + 1; // 1-5 scale
      
      return tag;
    });
  }

  // Find related tags (tags that appear together with this tag)
  async getRelatedTags(limit = 10) {
    const [rows] = await db.execute(
      `SELECT t.*, COUNT(*) as co_occurrence_count
       FROM tags t
       JOIN article_tags at1 ON t.id = at1.tag_id
       JOIN article_tags at2 ON at1.article_id = at2.article_id
       JOIN articles a ON at1.article_id = a.id
       WHERE at2.tag_id = ? 
         AND t.id != ? 
         AND t.is_active = true
         AND a.status = 'published'
       GROUP BY t.id
       ORDER BY co_occurrence_count DESC, t.name ASC
       LIMIT ?`,
      [this.id, this.id, limit]
    );

    return rows.map(row => {
      const tag = new Tag(row);
      tag.co_occurrence_count = row.co_occurrence_count;
      return tag;
    });
  }

  // Convert to public object (safe for API responses)
  toPublicObject() {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      description: this.description,
      color: this.color,
      is_active: this.is_active,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = Tag;