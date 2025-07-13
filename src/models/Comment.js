// src/models/Comment.js
const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class Comment {
  constructor(data) {
    this.id = data?.id;
    this.article_id = data?.article_id;
    this.user_id = data?.user_id;
    this.parent_id = data?.parent_id;
    this.author_name = data?.author_name;
    this.author_email = data?.author_email;
    this.content = data?.content;
    this.status = data?.status || 'pending';
    this.ip_address = data?.ip_address;
    this.user_agent = data?.user_agent;
    this.created_at = data?.created_at;
    this.updated_at = data?.updated_at;
  }

  // Create new comment
  static async create(commentData) {
    const {
      article_id,
      user_id,
      parent_id,
      author_name,
      author_email,
      content,
      status = 'pending',
      ip_address,
      user_agent
    } = commentData;

    const [result] = await db.execute(
      `INSERT INTO comments (
        article_id, user_id, parent_id, author_name, author_email,
        content, status, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        article_id, user_id, parent_id, author_name, author_email,
        content, status, ip_address, user_agent
      ]
    );

    const comment = await Comment.findById(result.insertId);
    return comment;
  }

  // Find comment by ID
  static async findById(id) {
    const [rows] = await db.execute(
      `SELECT c.*, u.username, u.first_name, u.last_name, u.profile_image
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    const comment = new Comment(rows[0]);
    if (comment.user_id) {
      comment.user = {
        id: comment.user_id,
        username: rows[0].username,
        first_name: rows[0].first_name,
        last_name: rows[0].last_name,
        profile_image: rows[0].profile_image
      };
    }

    return comment;
  }

  // Find comments by article
  static async findByArticle(articleId, page = 1, limit = 10, status = 'approved', sortBy = 'created_at', sortOrder = 'DESC') {
    const offset = (page - 1) * limit;

    // Get parent comments
    const [rows] = await db.execute(
      `SELECT c.*, u.username, u.first_name, u.last_name, u.profile_image
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.article_id = ? AND c.status = ? AND c.parent_id IS NULL
       ORDER BY c.${sortBy} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [articleId, status, limit, offset]
    );

    const [countRows] = await db.execute(
      'SELECT COUNT(*) as total FROM comments WHERE article_id = ? AND status = ? AND parent_id IS NULL',
      [articleId, status]
    );

    const comments = [];

    // Get replies for each parent comment
    for (const row of rows) {
      const comment = new Comment(row);
      if (comment.user_id) {
        comment.user = {
          id: comment.user_id,
          username: row.username,
          first_name: row.first_name,
          last_name: row.last_name,
          profile_image: row.profile_image
        };
      }

      // Get replies
      const [replyRows] = await db.execute(
        `SELECT c.*, u.username, u.first_name, u.last_name, u.profile_image
         FROM comments c
         LEFT JOIN users u ON c.user_id = u.id
         WHERE c.parent_id = ? AND c.status = ?
         ORDER BY c.created_at ASC`,
        [comment.id, status]
      );

      comment.replies = replyRows.map(replyRow => {
        const reply = new Comment(replyRow);
        if (reply.user_id) {
          reply.user = {
            id: reply.user_id,
            username: replyRow.username,
            first_name: replyRow.first_name,
            last_name: replyRow.last_name,
            profile_image: replyRow.profile_image
          };
        }
        return reply;
      });

      comments.push(comment);
    }

    return {
      comments,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      }
    };
  }

  // Find all comments with filters (admin)
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      status = null,
      article_id = null,
      user_id = null,
      search = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('c.status = ?');
      params.push(status);
    }

    if (article_id) {
      conditions.push('c.article_id = ?');
      params.push(article_id);
    }

    if (user_id) {
      conditions.push('c.user_id = ?');
      params.push(user_id);
    }

    if (search) {
      conditions.push('(c.content LIKE ? OR c.author_name LIKE ? OR c.author_email LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT c.*, u.username, u.first_name, u.last_name, u.profile_image,
             a.title as article_title, a.slug as article_slug
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN articles a ON c.article_id = a.id
      ${whereClause}
      ORDER BY c.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM comments c
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    const comments = rows.map(row => {
      const comment = new Comment(row);
      if (comment.user_id) {
        comment.user = {
          id: comment.user_id,
          username: row.username,
          first_name: row.first_name,
          last_name: row.last_name,
          profile_image: row.profile_image
        };
      }
      comment.article = {
        title: row.article_title,
        slug: row.article_slug
      };
      return comment;
    });

    return {
      comments,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      }
    };
  }

  // Update comment
  async update(updates) {
    const allowedUpdates = ['content', 'status'];
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
      `UPDATE comments SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Refresh comment data
    const updatedComment = await Comment.findById(this.id);
    Object.assign(this, updatedComment);

    return this;
  }

  // Delete comment
  async delete() {
    // Delete replies first
    await db.execute('DELETE FROM comments WHERE parent_id = ?', [this.id]);
    // Delete the comment itself
    await db.execute('DELETE FROM comments WHERE id = ?', [this.id]);
    return this;
  }

  // Approve comment
  async approve() {
    await this.update({ status: 'approved' });
    return this;
  }

  // Reject comment
  async reject(reason = null) {
    await this.update({ status: 'rejected' });
    // Could store rejection reason in a separate field or log
    return this;
  }

  // Mark as spam
  async markAsSpam() {
    await this.update({ status: 'spam' });
    return this;
  }

  // Get pending comments count
  static async getPendingCount() {
    const [rows] = await db.execute(
      'SELECT COUNT(*) as count FROM comments WHERE status = ?',
      ['pending']
    );

    return rows[0].count;
  }

  // Bulk actions
  static async bulkAction(commentIds, action, data = null) {
    const results = { processed: 0, failed: 0 };

    for (const id of commentIds) {
      try {
        const comment = await Comment.findById(id);
        if (!comment) {
          results.failed++;
          continue;
        }

        switch (action) {
          case 'approve':
            await comment.approve();
            break;
          case 'reject':
            await comment.reject(data?.reason);
            break;
          case 'spam':
            await comment.markAsSpam();
            break;
          case 'delete':
            await comment.delete();
            break;
          default:
            results.failed++;
            continue;
        }

        results.processed++;
      } catch (error) {
        results.failed++;
      }
    }

    return results;
  }

  // Get comment statistics
  static async getStatistics(days = 30) {
    const [rows] = await db.execute(
      `SELECT 
         COUNT(*) as total_comments,
         COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_comments,
         COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_comments,
         COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_comments,
         COUNT(CASE WHEN status = 'spam' THEN 1 END) as spam_comments,
         COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as registered_user_comments,
         COUNT(CASE WHEN user_id IS NULL THEN 1 END) as guest_comments
       FROM comments
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );

    return rows[0];
  }

  // Convert to public object (safe for API responses)
  toPublicObject() {
    const publicComment = {
      id: this.id,
      article_id: this.article_id,
      parent_id: this.parent_id,
      content: this.content,
      status: this.status,
      created_at: this.created_at,
      updated_at: this.updated_at
    };

    // Add author information
    if (this.user) {
      publicComment.author = {
        name: `${this.user.first_name} ${this.user.last_name}`.trim() || this.user.username,
        profile_image: this.user.profile_image
      };
    } else {
      publicComment.author = {
        name: this.author_name,
        profile_image: null
      };
    }

    // Add replies if they exist
    if (this.replies) {
      publicComment.replies = this.replies.map(reply => reply.toPublicObject());
    }

    return publicComment;
  }
}

module.exports = Comment;
