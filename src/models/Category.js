// src/models/Category.js
const db = require('../config/database');
const slugify = require('slugify');
const { AppError } = require('../middleware/errorHandler');

class Category {
  constructor(data) {
    this.id = data?.id;
    this.name = data?.name;
    this.slug = data?.slug;
    this.description = data?.description;
    this.parent_id = data?.parent_id;
    this.image = data?.image;
    this.meta_title = data?.meta_title;
    this.meta_description = data?.meta_description;
    this.sort_order = data?.sort_order || 0;
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
        `SELECT id FROM categories WHERE slug = ?${excludeId ? ' AND id != ?' : ''}`,
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

  // Create new category
  static async create(categoryData) {
    const {
      name,
      description,
      parent_id,
      image,
      meta_title,
      meta_description,
      sort_order = 0,
      is_active = true
    } = categoryData;

    // Generate slug
    const slug = await Category.generateSlug(name);

    const [result] = await db.execute(
      `INSERT INTO categories (
        name, slug, description, parent_id, image, meta_title,
        meta_description, sort_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, slug, description, parent_id, image, meta_title,
        meta_description, sort_order, is_active
      ]
    );

    const category = await Category.findById(result.insertId);
    return category;
  }

  // Find category by ID
  static async findById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM categories WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    return new Category(rows[0]);
  }

  // Find category by slug
  static async findBySlug(slug) {
    const [rows] = await db.execute(
      'SELECT * FROM categories WHERE slug = ?',
      [slug]
    );

    if (rows.length === 0) {
      return null;
    }

    return new Category(rows[0]);
  }

  // Find all categories with pagination and filters
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      is_active = null,
      parent_id = undefined,
      sortBy = 'sort_order',
      sortOrder = 'ASC'
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (is_active !== null) {
      conditions.push('is_active = ?');
      params.push(is_active);
    }

    if (parent_id !== undefined) {
      if (parent_id === null) {
        conditions.push('parent_id IS NULL');
      } else {
        conditions.push('parent_id = ?');
        params.push(parent_id);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT c.*, p.name as parent_name
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      ${whereClause}
      ORDER BY c.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM categories c
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    const categories = rows.map(row => {
      const category = new Category(row);
      category.parent_name = row.parent_name;
      return category;
    });

    const total = countRows[0].total;

    return {
      categories,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Get category tree (hierarchical structure)
  static async getTree(activeOnly = true) {
    let query = `
      SELECT c.*, COUNT(a.id) as article_count
      FROM categories c
      LEFT JOIN articles a ON c.id = a.category_id AND a.status = 'published'
    `;

    if (activeOnly) {
      query += ' WHERE c.is_active = true';
    }

    query += `
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC
    `;

    const [rows] = await db.execute(query);

    // Build tree structure
    const categories = rows.map(row => ({
      ...new Category(row).toPublicObject(),
      article_count: row.article_count,
      children: []
    }));

    const categoryMap = {};
    const rootCategories = [];

    // Create a map for quick lookup
    categories.forEach(category => {
      categoryMap[category.id] = category;
    });

    // Build the tree
    categories.forEach(category => {
      if (category.parent_id) {
        const parent = categoryMap[category.parent_id];
        if (parent) {
          parent.children.push(category);
        }
      } else {
        rootCategories.push(category);
      }
    });

    return rootCategories;
  }

  // Update category
  async update(updates) {
    const allowedUpdates = [
      'name', 'description', 'parent_id', 'image', 'meta_title',
      'meta_description', 'sort_order', 'is_active'
    ];

    const updateFields = [];
    const updateValues = [];

    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key) && updates[key] !== undefined) {
        updateFields.push(`${key} = ?`);
        updateValues.push(updates[key]);

        // Update slug if name is changed
        if (key === 'name') {
          updateFields.push('slug = ?');
          updateValues.push(Category.generateSlug(updates[key], this.id));
        }
      }
    });

    if (updateFields.length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    updateValues.push(this.id);

    await db.execute(
      `UPDATE categories SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Refresh category data
    const updatedCategory = await Category.findById(this.id);
    Object.assign(this, updatedCategory);

    return this;
  }

  // Delete category
  async delete() {
    await db.execute('DELETE FROM categories WHERE id = ?', [this.id]);
    return this;
  }

  // Get category articles
  async getArticles(page = 1, limit = 10, status = 'published', sortBy = 'published_at', sortOrder = 'DESC') {
    const offset = (page - 1) * limit;

    const [rows] = await db.execute(
      `SELECT a.*, u.username as author_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       WHERE a.category_id = ? AND a.status = ?
       ORDER BY a.${sortBy} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [this.id, status, limit, offset]
    );

    const [countRows] = await db.execute(
      'SELECT COUNT(*) as total FROM articles WHERE category_id = ? AND status = ?',
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

  // Get article count for this category
  async getArticleCount(status = 'published') {
    const [rows] = await db.execute(
      'SELECT COUNT(*) as count FROM articles WHERE category_id = ? AND status = ?',
      [this.id, status]
    );

    return rows[0].count;
  }

  // Check if category has children
  async hasChildren() {
    const [rows] = await db.execute(
      'SELECT COUNT(*) as count FROM categories WHERE parent_id = ?',
      [this.id]
    );

    return rows[0].count > 0;
  }

  // Get category children
  async getChildren() {
    const [rows] = await db.execute(
      'SELECT * FROM categories WHERE parent_id = ? ORDER BY sort_order ASC, name ASC',
      [this.id]
    );

    return rows.map(row => new Category(row));
  }

  // Get category path (breadcrumb)
  async getPath() {
    const path = [this];
    let currentCategory = this;

    while (currentCategory.parent_id) {
      const parent = await Category.findById(currentCategory.parent_id);
      if (parent) {
        path.unshift(parent);
        currentCategory = parent;
      } else {
        break;
      }
    }

    return path;
  }

  // Reorder categories
  static async reorder(categoryOrders) {
    const promises = categoryOrders.map(({ id, sort_order }) =>
      db.execute(
        'UPDATE categories SET sort_order = ? WHERE id = ?',
        [sort_order, id]
      )
    );

    await Promise.all(promises);
    return true;
  }

  // Convert to public object (safe for API responses)
  toPublicObject() {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      description: this.description,
      parent_id: this.parent_id,
      image: this.image,
      meta_title: this.meta_title,
      meta_description: this.meta_description,
      sort_order: this.sort_order,
      is_active: this.is_active,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = Category;