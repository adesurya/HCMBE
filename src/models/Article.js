// src/models/Article.js
const db = require('../config/database');
const slugify = require('slugify');
const { AppError } = require('../middleware/errorHandler');

class Article {
  constructor(data) {
    this.id = data?.id;
    this.title = data?.title;
    this.slug = data?.slug;
    this.excerpt = data?.excerpt;
    this.content = data?.content;
    this.featured_image = data?.featured_image;
    this.author_id = data?.author_id;
    this.category_id = data?.category_id;
    this.status = data?.status || 'draft';
    this.is_featured = data?.is_featured ?? false;
    this.is_breaking = data?.is_breaking ?? false;
    this.views = data?.views || 0;
    this.likes = data?.likes || 0;
    this.meta_title = data?.meta_title;
    this.meta_description = data?.meta_description;
    this.meta_keywords = data?.meta_keywords;
    this.published_at = data?.published_at;
    this.scheduled_at = data?.scheduled_at;
    this.created_at = data?.created_at;
    this.updated_at = data?.updated_at;
    this.approved_by = data?.approved_by;
    this.approved_at = data?.approved_at;
  }

  // Generate unique slug
  static async generateSlug(title, excludeId = null) {
    let baseSlug = slugify(title, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const [rows] = await db.execute(
        `SELECT id FROM articles WHERE slug = ?${excludeId ? ' AND id != ?' : ''}`,
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

  // Create new article
  static async create(articleData, authorId) {
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
    } = articleData;

    // Generate slug
    const slug = await Article.generateSlug(title);

    // Set published_at if status is published
    const published_at = status === 'published' ? new Date() : null;

    const [result] = await db.execute(
      `INSERT INTO articles (
        title, slug, content, excerpt, author_id, category_id, featured_image,
        meta_title, meta_description, meta_keywords, is_featured, is_breaking,
        status, published_at, scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, slug, content, excerpt, authorId, category_id, featured_image,
        meta_title, meta_description, meta_keywords, is_featured, is_breaking,
        status, published_at, scheduled_at
      ]
    );

    const articleId = result.insertId;

    // Add tags if provided
    if (tags && tags.length > 0) {
      await Article.addTags(articleId, tags);
    }

    const article = await Article.findById(articleId);
    return article;
  }

  // Find article by ID
  static async findById(id, includeRelations = true) {
    let query = 'SELECT * FROM articles WHERE id = ?';
    
    const [rows] = await db.execute(query, [id]);

    if (rows.length === 0) {
      return null;
    }

    const article = new Article(rows[0]);

    if (includeRelations) {
      await article.loadRelations();
    }

    return article;
  }

  // Find article by slug
  static async findBySlug(slug, includeRelations = true) {
    const [rows] = await db.execute(
      'SELECT * FROM articles WHERE slug = ?',
      [slug]
    );

    if (rows.length === 0) {
      return null;
    }

    const article = new Article(rows[0]);

    if (includeRelations) {
      await article.loadRelations();
    }

    return article;
  }

  // Get all articles with pagination and filters
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 10,
      status = null,
      category_id = null,
      author_id = null,
      is_featured = null,
      is_breaking = null,
      search = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // Build WHERE conditions
    if (status) {
      conditions.push('a.status = ?');
      params.push(status);
    }

    if (category_id) {
      conditions.push('a.category_id = ?');
      params.push(category_id);
    }

    if (author_id) {
      conditions.push('a.author_id = ?');
      params.push(author_id);
    }

    if (is_featured !== null) {
      conditions.push('a.is_featured = ?');
      params.push(is_featured);
    }

    if (is_breaking !== null) {
      conditions.push('a.is_breaking = ?');
      params.push(is_breaking);
    }

    if (search) {
      conditions.push('MATCH(a.title, a.excerpt, a.content) AGAINST(? IN NATURAL LANGUAGE MODE)');
      params.push(search);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Main query
    const query = `
      SELECT a.*, 
             u.username as author_name, 
             u.first_name as author_first_name, 
             u.last_name as author_last_name,
             c.name as category_name, 
             c.slug as category_slug
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      ${whereClause}
      ORDER BY a.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM articles a
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    const articles = rows.map(row => {
      const article = new Article(row);
      article.author = {
        id: article.author_id,
        username: row.author_name,
        first_name: row.author_first_name,
        last_name: row.author_last_name
      };
      article.category = row.category_id ? {
        id: article.category_id,
        name: row.category_name,
        slug: row.category_slug
      } : null;
      return article;
    });

    const total = countRows[0].total;

    return {
      articles,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Load article relations (author, category, tags)
  async loadRelations() {
    // Load author
    const [authorRows] = await db.execute(
      'SELECT id, username, first_name, last_name, profile_image FROM users WHERE id = ?',
      [this.author_id]
    );

    if (authorRows.length > 0) {
      this.author = authorRows[0];
    }

    // Load category
    if (this.category_id) {
      const [categoryRows] = await db.execute(
        'SELECT id, name, slug FROM categories WHERE id = ?',
        [this.category_id]
      );

      if (categoryRows.length > 0) {
        this.category = categoryRows[0];
      }
    }

    // Load tags
    const [tagRows] = await db.execute(
      `SELECT t.id, t.name, t.slug, t.color 
       FROM tags t 
       JOIN article_tags at ON t.id = at.tag_id 
       WHERE at.article_id = ?`,
      [this.id]
    );

    this.tags = tagRows;

    return this;
  }

  // Update article
  async update(updates, userId = null) {
    const allowedUpdates = [
      'title', 'content', 'excerpt', 'category_id', 'featured_image',
      'meta_title', 'meta_description', 'meta_keywords', 'is_featured',
      'is_breaking', 'status', 'scheduled_at'
    ];

    const updateFields = [];
    const updateValues = [];

    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key) && updates[key] !== undefined) {
        updateFields.push(`${key} = ?`);
        updateValues.push(updates[key]);

        // Update slug if title is changed
        if (key === 'title') {
          updateFields.push('slug = ?');
          updateValues.push(Article.generateSlug(updates[key], this.id));
        }

        // Set published_at if status changes to published
        if (key === 'status' && updates[key] === 'published' && this.status !== 'published') {
          updateFields.push('published_at = ?');
          updateValues.push(new Date());
        }
      }
    });

    if (updateFields.length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    updateValues.push(this.id);

    await db.execute(
      `UPDATE articles SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Update tags if provided
    if (updates.tags !== undefined) {
      await this.updateTags(updates.tags);
    }

    // Refresh article data
    const updatedArticle = await Article.findById(this.id);
    Object.assign(this, updatedArticle);

    return this;
  }

  // Approve article (for editors)
  async approve(editorId) {
    await db.execute(
      'UPDATE articles SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, published_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['published', editorId, this.id]
    );

    this.status = 'published';
    this.approved_by = editorId;
    this.approved_at = new Date();
    this.published_at = new Date();

    return this;
  }

  // Increment views
  async incrementViews() {
    await db.execute(
      'UPDATE articles SET views = views + 1 WHERE id = ?',
      [this.id]
    );

    this.views = (this.views || 0) + 1;
    return this;
  }

  // Increment likes
  async incrementLikes() {
    await db.execute(
      'UPDATE articles SET likes = likes + 1 WHERE id = ?',
      [this.id]
    );

    this.likes = (this.likes || 0) + 1;
    return this;
  }

  // Add tags to article
  static async addTags(articleId, tagIds) {
    if (!tagIds || tagIds.length === 0) return;

    const values = tagIds.map(tagId => [articleId, tagId]);
    const placeholders = values.map(() => '(?, ?)').join(', ');

    await db.execute(
      `INSERT IGNORE INTO article_tags (article_id, tag_id) VALUES ${placeholders}`,
      values.flat()
    );
  }

  // Update article tags
  async updateTags(tagIds) {
    // Remove existing tags
    await db.execute(
      'DELETE FROM article_tags WHERE article_id = ?',
      [this.id]
    );

    // Add new tags
    if (tagIds && tagIds.length > 0) {
      await Article.addTags(this.id, tagIds);
    }

    return this;
  }

  // Delete article
  async delete() {
    // Delete related data first
    await db.execute('DELETE FROM article_tags WHERE article_id = ?', [this.id]);
    await db.execute('DELETE FROM comments WHERE article_id = ?', [this.id]);
    await db.execute('DELETE FROM analytics WHERE article_id = ?', [this.id]);
    
    // Delete article
    await db.execute('DELETE FROM articles WHERE id = ?', [this.id]);

    return this;
  }

  // Get article comments
  async getComments(page = 1, limit = 10, status = 'approved') {
    const offset = (page - 1) * limit;

    const [rows] = await db.execute(
      `SELECT c.*, u.username, u.first_name, u.last_name, u.profile_image
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.article_id = ? AND c.status = ? AND c.parent_id IS NULL
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [this.id, status, limit, offset]
    );

    const [countRows] = await db.execute(
      'SELECT COUNT(*) as total FROM comments WHERE article_id = ? AND status = ? AND parent_id IS NULL',
      [this.id, status]
    );

    // Get replies for each comment
    for (const comment of rows) {
      const [replies] = await db.execute(
        `SELECT c.*, u.username, u.first_name, u.last_name, u.profile_image
         FROM comments c
         LEFT JOIN users u ON c.user_id = u.id
         WHERE c.parent_id = ? AND c.status = ?
         ORDER BY c.created_at ASC`,
        [comment.id, status]
      );
      comment.replies = replies;
    }

    return {
      comments: rows,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      }
    };
  }

  // Get related articles
  async getRelatedArticles(limit = 5) {
    const [rows] = await db.execute(
      `SELECT a.*, u.username as author_name, c.name as category_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       LEFT JOIN categories c ON a.category_id = c.id
       WHERE a.id != ? 
         AND a.status = 'published' 
         AND (a.category_id = ? OR a.id IN (
           SELECT DISTINCT at2.article_id 
           FROM article_tags at1 
           JOIN article_tags at2 ON at1.tag_id = at2.tag_id 
           WHERE at1.article_id = ? AND at2.article_id != ?
         ))
       ORDER BY a.published_at DESC
       LIMIT ?`,
      [this.id, this.category_id, this.id, this.id, limit]
    );

    return rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
      article.category = { name: row.category_name };
      return article;
    });
  }

  // Search articles
  static async search(query, options = {}) {
    const {
      page = 1,
      limit = 10,
      category_id = null,
      status = 'published'
    } = options;

    const offset = (page - 1) * limit;
    const conditions = ['MATCH(a.title, a.excerpt, a.content) AGAINST(? IN NATURAL LANGUAGE MODE)'];
    const params = [query];

    if (status) {
      conditions.push('a.status = ?');
      params.push(status);
    }

    if (category_id) {
      conditions.push('a.category_id = ?');
      params.push(category_id);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const searchQuery = `
      SELECT a.*, 
             u.username as author_name,
             c.name as category_name,
             MATCH(a.title, a.excerpt, a.content) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      ${whereClause}
      ORDER BY relevance DESC, a.published_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM articles a
      ${whereClause}
    `;

    const [rows] = await db.execute(searchQuery, [query, ...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, [query, ...params]);

    const articles = rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
      article.category = { name: row.category_name };
      article.relevance = row.relevance;
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

  // Get articles by category
  static async findByCategory(categoryId, page = 1, limit = 10, status = 'published') {
    return await Article.findAll({
      page,
      limit,
      category_id: categoryId,
      status,
      sortBy: 'published_at',
      sortOrder: 'DESC'
    });
  }

  // Get featured articles
  static async getFeatured(limit = 5, status = 'published') {
    const [rows] = await db.execute(
      `SELECT a.*, u.username as author_name, c.name as category_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       LEFT JOIN categories c ON a.category_id = c.id
       WHERE a.is_featured = true AND a.status = ?
       ORDER BY a.published_at DESC
       LIMIT ?`,
      [status, limit]
    );

    return rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
      article.category = { name: row.category_name };
      return article;
    });
  }

  // Get breaking news
  static async getBreaking(limit = 5, status = 'published') {
    const [rows] = await db.execute(
      `SELECT a.*, u.username as author_name, c.name as category_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       LEFT JOIN categories c ON a.category_id = c.id
       WHERE a.is_breaking = true AND a.status = ?
       ORDER BY a.published_at DESC
       LIMIT ?`,
      [status, limit]
    );

    return rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
      article.category = { name: row.category_name };
      return article;
    });
  }

  // Get popular articles (most viewed)
  static async getPopular(limit = 10, days = 7, status = 'published') {
    const [rows] = await db.execute(
      `SELECT a.*, u.username as author_name, c.name as category_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       LEFT JOIN categories c ON a.category_id = c.id
       WHERE a.status = ? 
         AND a.published_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY a.views DESC
       LIMIT ?`,
      [status, days, limit]
    );

    return rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
      article.category = { name: row.category_name };
      return article;
    });
  }

  // Get articles requiring approval
  static async getPendingApproval(page = 1, limit = 10) {
    return await Article.findAll({
      page,
      limit,
      status: 'ready_to_post',
      sortBy: 'created_at',
      sortOrder: 'ASC'
    });
  }

  // Get scheduled articles
  static async getScheduled(page = 1, limit = 10) {
    const offset = (page - 1) * limit;

    const [rows] = await db.execute(
      `SELECT a.*, u.username as author_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       WHERE a.scheduled_at IS NOT NULL 
         AND a.scheduled_at > NOW() 
         AND a.status = 'draft'
       ORDER BY a.scheduled_at ASC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total
       FROM articles
       WHERE scheduled_at IS NOT NULL 
         AND scheduled_at > NOW() 
         AND status = 'draft'`
    );

    const articles = rows.map(row => {
      const article = new Article(row);
      article.author = { username: row.author_name };
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

  // Check if user can edit article
  canEdit(userId, userRole) {
    // Admin and editors can edit any article
    if (userRole === 'admin' || userRole === 'editor') {
      return true;
    }

    // Journalists can only edit their own articles
    if (userRole === 'journalist' && this.author_id === userId) {
      return true;
    }

    return false;
  }

  // Get article analytics summary
  async getAnalyticsSummary(days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         COUNT(*) as total_views,
         COUNT(DISTINCT ip_address) as unique_views,
         AVG(view_duration) as avg_duration,
         DATE(created_at) as date,
         COUNT(*) as daily_views
       FROM analytics 
       WHERE article_id = ? 
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [this.id, days]
    );

    const [totalRows] = await db.execute(
      `SELECT 
         COUNT(*) as total_views,
         COUNT(DISTINCT ip_address) as unique_views,
         AVG(view_duration) as avg_duration
       FROM analytics 
       WHERE article_id = ?`,
      [this.id]
    );

    return {
      daily_stats: rows,
      total_stats: totalRows[0] || { total_views: 0, unique_views: 0, avg_duration: 0 }
    };
  }

  // Convert to public object (safe for API responses)
  toPublicObject() {
    const { password_hash, ...publicData } = this;
    return publicData;
  }

  // Convert to summary object (for listings)
  toSummaryObject() {
    return {
      id: this.id,
      title: this.title,
      slug: this.slug,
      excerpt: this.excerpt,
      featured_image: this.featured_image,
      author: this.author,
      category: this.category,
      status: this.status,
      is_featured: this.is_featured,
      is_breaking: this.is_breaking,
      views: this.views,
      likes: this.likes,
      published_at: this.published_at,
      created_at: this.created_at,
      tags: this.tags
    };
  }
}

module.exports = Article;