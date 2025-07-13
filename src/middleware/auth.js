// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const logger = require('../utils/logger');

// Verify JWT token
const verifyToken = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists and is active
    const [rows] = await db.query(
      'SELECT id, username, email, role, is_active FROM users WHERE id = ?',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token. User not found.'
      });
    }

    const user = rows[0];
    
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated.'
      });
    }
    req.user = user;
    next();
  } catch (error) {
    logger.error('Token verification error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token has expired.'
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid token.'
    });
  }
};

// Check if user has required role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions.'
      });
    }

    next();
  };
};

// Optional authentication (for public routes with optional user info)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const [rows] = await db.query(
      'SELECT id, username, email, role, is_active FROM users WHERE id = ?',
      [decoded.id]
    );

    if (rows.length > 0 && rows[0].is_active) {
      req.user = rows[0];
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

// Check if user can access article based on status and role
const checkArticleAccess = async (req, res, next) => {
  try {
    const articleId = req.params.id;
    
    const [rows] = await db.query(
      'SELECT status, author_id FROM articles WHERE id = ?',
      [articleId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Article not found.'
      });
    }

    const article = rows[0];
    
    // Public can access published articles
    if (article.status === 'published') {
      return next();
    }
    
    // Authentication required for non-published articles
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }
    
    // Admin and editors can access all articles
    if (req.user.role === 'admin' || req.user.role === 'editor') {
      return next();
    }
    
    // Authors can access their own articles
    if (req.user.role === 'journalist' && article.author_id === req.user.id) {
      return next();
    }
    
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions to access this article.'
    });
  } catch (error) {
    logger.error('Article access check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error.'
    });
  }
};

// Rate limiting for login attempts
const loginLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many login attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  verifyToken,
  requireRole,
  optionalAuth,
  checkArticleAccess,
  loginLimiter
};