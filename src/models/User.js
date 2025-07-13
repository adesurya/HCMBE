// src/models/User.js
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');

class User {
  constructor(data) {
    this.id = data?.id;
    this.username = data?.username;
    this.email = data?.email;
    this.password_hash = data?.password_hash;
    this.first_name = data?.first_name;
    this.last_name = data?.last_name;
    this.role = data?.role || 'user';
    this.profile_image = data?.profile_image;
    this.bio = data?.bio;
    this.is_active = data?.is_active ?? true;
    this.email_verified = data?.email_verified ?? false;
    this.verification_token = data?.verification_token;
    this.reset_token = data?.reset_token;
    this.reset_token_expires = data?.reset_token_expires;
    this.last_login = data?.last_login;
    this.created_at = data?.created_at;
    this.updated_at = data?.updated_at;
  }

  // Create new user
  static async create(userData) {
    const { username, email, password, first_name, last_name, role = 'user' } = userData;

    // Check if user already exists
    const existingUser = await User.findByEmailOrUsername(email, username);
    if (existingUser) {
      throw new AppError('User with this email or username already exists', 400);
    }

    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Generate verification token
    const verification_token = crypto.randomBytes(32).toString('hex');

    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, role, verification_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, email, password_hash, first_name, last_name, role, verification_token]
    );

    const user = await User.findById(result.insertId);
    return user;
  }

  // Find user by ID
  static async findById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE id = ? AND is_active = true',
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    return new User(rows[0]);
  }

  // Find user by email
  static async findByEmail(email) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = true',
      [email]
    );

    if (rows.length === 0) {
      return null;
    }

    return new User(rows[0]);
  }

  // Find user by username
  static async findByUsername(username) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE username = ? AND is_active = true',
      [username]
    );

    if (rows.length === 0) {
      return null;
    }

    return new User(rows[0]);
  }

  // Find user by email or username
  static async findByEmailOrUsername(email, username) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE (email = ? OR username = ?) AND is_active = true',
      [email, username]
    );

    if (rows.length === 0) {
      return null;
    }

    return new User(rows[0]);
  }

  // Find user by verification token
  static async findByVerificationToken(token) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE verification_token = ?',
      [token]
    );

    if (rows.length === 0) {
      return null;
    }

    return new User(rows[0]);
  }

  // Find user by reset token
  static async findByResetToken(token) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [token]
    );

    if (rows.length === 0) {
      return null;
    }

    return new User(rows[0]);
  }

  // Get all users with pagination
  static async findAll(page = 1, limit = 10, role = null) {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM users WHERE is_active = true';
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE is_active = true';
    const params = [];

    if (role) {
      query += ' AND role = ?';
      countQuery += ' AND role = ?';
      params.push(role);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await db.execute(query, params);
    const [countRows] = await db.execute(countQuery, role ? [role] : []);

    const users = rows.map(row => new User(row));
    const total = countRows[0].total;

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Update user
  async update(updates) {
    const allowedUpdates = ['username', 'email', 'first_name', 'last_name', 'profile_image', 'bio', 'role', 'is_active'];
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
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Refresh user data
    const updatedUser = await User.findById(this.id);
    Object.assign(this, updatedUser);

    return this;
  }

  // Update password
  async updatePassword(newPassword) {
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(newPassword, saltRounds);

    await db.execute(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [password_hash, this.id]
    );

    this.password_hash = password_hash;
    return this;
  }

  // Verify password
  async verifyPassword(password) {
    return await bcrypt.compare(password, this.password_hash);
  }

  // Generate JWT token
  generateToken() {
    return jwt.sign(
      { id: this.id, email: this.email, role: this.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
  }

  // Generate refresh token
  generateRefreshToken() {
    return jwt.sign(
      { id: this.id, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
  }

  // Generate password reset token
  async generateResetToken() {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.execute(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [resetToken, resetTokenExpires, this.id]
    );

    this.reset_token = resetToken;
    this.reset_token_expires = resetTokenExpires;

    return resetToken;
  }

  // Verify email
  async verifyEmail() {
    await db.execute(
      'UPDATE users SET email_verified = true, verification_token = NULL WHERE id = ?',
      [this.id]
    );

    this.email_verified = true;
    this.verification_token = null;

    return this;
  }

  // Update last login
  async updateLastLogin() {
    await db.execute(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [this.id]
    );

    this.last_login = new Date();
    return this;
  }

  // Soft delete user
  async delete() {
    await db.execute(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [this.id]
    );

    this.is_active = false;
    return this;
  }

  // Get user's articles
  async getArticles(page = 1, limit = 10, status = null) {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM articles WHERE author_id = ?';
    let countQuery = 'SELECT COUNT(*) as total FROM articles WHERE author_id = ?';
    const params = [this.id];

    if (status) {
      query += ' AND status = ?';
      countQuery += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await db.execute(query, params);
    const [countRows] = await db.execute(countQuery, status ? [this.id, status] : [this.id]);

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

  // Get user's comments
  async getComments(page = 1, limit = 10) {
    const offset = (page - 1) * limit;

    const [rows] = await db.execute(
      `SELECT c.*, a.title as article_title, a.slug as article_slug 
       FROM comments c 
       LEFT JOIN articles a ON c.article_id = a.id 
       WHERE c.user_id = ? 
       ORDER BY c.created_at DESC 
       LIMIT ? OFFSET ?`,
      [this.id, limit, offset]
    );

    const [countRows] = await db.execute(
      'SELECT COUNT(*) as total FROM comments WHERE user_id = ?',
      [this.id]
    );

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

  // Check if user can perform action
  canPerformAction(action, resource = null) {
    const permissions = {
      admin: ['create', 'read', 'update', 'delete', 'approve', 'manage'],
      editor: ['create', 'read', 'update', 'delete', 'approve'],
      journalist: ['create', 'read', 'update_own'],
      user: ['read', 'comment']
    };

    const userPermissions = permissions[this.role] || [];

    // Check if action is in user permissions
    if (userPermissions.includes(action)) {
      return true;
    }

    // Special case for 'update_own' - journalists can update their own articles
    if (action === 'update' && this.role === 'journalist' && resource && resource.author_id === this.id) {
      return true;
    }

    return false;
  }

  // Get safe user data (without sensitive fields)
  toSafeObject() {
    const { password_hash, verification_token, reset_token, reset_token_expires, ...safeUser } = this;
    return safeUser;
  }

  // Get public user data
  toPublicObject() {
    return {
      id: this.id,
      username: this.username,
      first_name: this.first_name,
      last_name: this.last_name,
      profile_image: this.profile_image,
      bio: this.bio,
      role: this.role,
      created_at: this.created_at
    };
  }
}

module.exports = User;