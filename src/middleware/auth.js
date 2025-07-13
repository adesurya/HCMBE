// src/middleware/auth.js - Enhanced with OTP security
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const redis = require('../config/redis');
const logger = require('../../scripts/baksrc/utils/logger');

// Verify JWT token with enhanced security
const verifyToken = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.'
      });
    }

    // Check if token is blacklisted
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        error: 'Token has been revoked.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists and is active
    const [rows] = await db.query(
      `SELECT id, username, email, role, is_active, email_verified, 
              last_login, failed_login_attempts, account_locked_until
       FROM users WHERE id = ?`,
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token. User not found.'
      });
    }

    const user = rows[0];
    
    // Check if account is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated.'
      });
    }

    // Check if email is verified
    if (!user.email_verified) {
      return res.status(401).json({
        success: false,
        error: 'Please verify your email address.'
      });
    }

    // Check if account is locked
    if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
      return res.status(401).json({
        success: false,
        error: 'Account is temporarily locked. Please try again later.'
      });
    }

    // Update last activity for session tracking
    await updateLastActivity(user.id, req.ip, req.get('User-Agent'));

    req.user = user;
    next();
  } catch (error) {
    logger.error('Token verification error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token has expired.',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid token.'
    });
  }
};

// Update last activity for session tracking
const updateLastActivity = async (userId, ip, userAgent) => {
  try {
    // Update last activity in database
    await db.execute(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [userId]
    );

    // Store session activity in Redis
    const sessionKey = `session_activity:${userId}`;
    const activityData = {
      lastActivity: new Date().toISOString(),
      ip,
      userAgent,
      timestamp: Date.now()
    };

    await redis.set(sessionKey, JSON.stringify(activityData), 24 * 60 * 60); // 24 hours
  } catch (error) {
    logger.error('Error updating last activity:', error);
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

    const userRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!userRoles.includes(req.user.role)) {
      logger.warn('Insufficient permissions attempt', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: userRoles,
        endpoint: req.path,
        ip: req.ip
      });
      
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

    // Check if token is blacklisted
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const [rows] = await db.query(
      'SELECT id, username, email, role, is_active, email_verified FROM users WHERE id = ?',
      [decoded.id]
    );

    if (rows.length > 0 && rows[0].is_active && rows[0].email_verified) {
      req.user = rows[0];
      await updateLastActivity(req.user.id, req.ip, req.get('User-Agent'));
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
      'SELECT status, author_id FROM articles WHERE id = ? OR slug = ?',
      [articleId, articleId]
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

// Enhanced rate limiting for login attempts with progressive delays
const createLoginLimiter = () => {
  const attempts = new Map();
  
  return async (req, res, next) => {
    const identifier = req.body.email || req.ip;
    const now = Date.now();
    
    // Clean old attempts (older than 1 hour)
    const oneHourAgo = now - (60 * 60 * 1000);
    if (attempts.has(identifier)) {
      const userAttempts = attempts.get(identifier);
      userAttempts.attempts = userAttempts.attempts.filter(time => time > oneHourAgo);
      
      if (userAttempts.attempts.length === 0) {
        attempts.delete(identifier);
      }
    }
    
    // Check if user should be rate limited
    if (attempts.has(identifier)) {
      const userAttempts = attempts.get(identifier);
      const recentAttempts = userAttempts.attempts.length;
      
      if (recentAttempts >= 5) {
        const lastAttempt = Math.max(...userAttempts.attempts);
        const timeSinceLastAttempt = now - lastAttempt;
        const requiredDelay = Math.min(300000, Math.pow(2, recentAttempts - 5) * 1000); // Max 5 minutes
        
        if (timeSinceLastAttempt < requiredDelay) {
          const waitTime = Math.ceil((requiredDelay - timeSinceLastAttempt) / 1000);
          
          logger.warn('Login rate limited', {
            identifier,
            attempts: recentAttempts,
            waitTime,
            ip: req.ip
          });
          
          return res.status(429).json({
            success: false,
            error: `Too many login attempts. Please wait ${waitTime} seconds before trying again.`,
            waitTime,
            attempts: recentAttempts
          });
        }
      }
    }
    
    // Record this attempt
    if (!attempts.has(identifier)) {
      attempts.set(identifier, { attempts: [] });
    }
    attempts.get(identifier).attempts.push(now);
    
    next();
  };
};

const loginLimiter = createLoginLimiter();

// Enhanced OTP rate limiting
const otpLimiter = async (req, res, next) => {
  const identifier = req.body.otpToken || req.ip;
  const key = `otp_attempts:${identifier}`;
  
  try {
    const attempts = await redis.incr(key, 300); // 5 minutes window
    
    if (attempts > 10) { // Max 10 OTP attempts per 5 minutes
      logger.warn('OTP rate limited', {
        identifier,
        attempts,
        ip: req.ip
      });
      
      return res.status(429).json({
        success: false,
        error: 'Too many OTP attempts. Please wait 5 minutes before trying again.'
      });
    }
    
    next();
  } catch (error) {
    logger.error('OTP rate limiter error:', error);
    next(); // Don't block on Redis errors
  }
};

// Blacklist token on logout
const blacklistToken = async (token, expiresIn = 24 * 60 * 60) => {
  try {
    await redis.set(`blacklist:${token}`, '1', expiresIn);
  } catch (error) {
    logger.error('Error blacklisting token:', error);
  }
};

// Check for suspicious login patterns
const detectSuspiciousActivity = async (req, res, next) => {
  if (!req.user) return next();
  
  try {
    const userId = req.user.id;
    const currentIP = req.ip;
    const userAgent = req.get('User-Agent');
    
    // Get recent login history
    const recentLoginsKey = `recent_logins:${userId}`;
    const recentLoginsData = await redis.get(recentLoginsKey);
    const recentLogins = recentLoginsData ? JSON.parse(recentLoginsData) : [];
    
    // Check for suspicious patterns
    const suspiciousPatterns = [];
    
    // Different IP addresses in short time
    const recentIPs = recentLogins
      .filter(login => Date.now() - new Date(login.timestamp).getTime() < 60 * 60 * 1000) // Last hour
      .map(login => login.ip);
    
    if (recentIPs.length > 0 && !recentIPs.includes(currentIP)) {
      suspiciousPatterns.push('different_ip');
    }
    
    // Different user agent
    const recentUserAgents = recentLogins
      .filter(login => Date.now() - new Date(login.timestamp).getTime() < 24 * 60 * 60 * 1000) // Last 24 hours
      .map(login => login.userAgent);
    
    if (recentUserAgents.length > 0 && !recentUserAgents.includes(userAgent)) {
      suspiciousPatterns.push('different_device');
    }
    
    // Unusual login time (outside normal hours)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 23) {
      suspiciousPatterns.push('unusual_time');
    }
    
    // Log suspicious activity
    if (suspiciousPatterns.length > 0) {
      logger.warn('Suspicious login activity detected', {
        userId,
        ip: currentIP,
        userAgent,
        patterns: suspiciousPatterns,
        timestamp: new Date().toISOString()
      });
      
      // Could trigger additional security measures here
      // like requiring re-authentication or sending alerts
    }
    
    // Update recent logins
    const newLogin = {
      ip: currentIP,
      userAgent,
      timestamp: new Date().toISOString(),
      suspicious: suspiciousPatterns.length > 0
    };
    
    recentLogins.unshift(newLogin);
    recentLogins.splice(10); // Keep only last 10 logins
    
    await redis.set(recentLoginsKey, JSON.stringify(recentLogins), 7 * 24 * 60 * 60); // 7 days
    
    next();
  } catch (error) {
    logger.error('Error in suspicious activity detection:', error);
    next(); // Don't block on errors
  }
};

// Session cleanup - remove old/invalid sessions
const cleanupSessions = async () => {
  try {
    // This would be called by a cron job
    logger.info('Cleaning up old sessions...');
    // Implementation depends on your session storage strategy
  } catch (error) {
    logger.error('Error cleaning up sessions:', error);
  }
};

// Middleware to require email verification
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }
  
  if (!req.user.email_verified) {
    return res.status(403).json({
      success: false,
      error: 'Email verification required.',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  
  next();
};

// Middleware to check account status
const checkAccountStatus = async (req, res, next) => {
  if (!req.user) return next();
  
  try {
    const [rows] = await db.query(
      `SELECT is_active, account_locked_until, email_verified, 
              failed_login_attempts, last_password_change
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User account not found.'
      });
    }
    
    const account = rows[0];
    
    if (!account.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated.',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }
    
    if (account.account_locked_until && new Date(account.account_locked_until) > new Date()) {
      const unlockTime = new Date(account.account_locked_until).toISOString();
      return res.status(403).json({
        success: false,
        error: 'Account is temporarily locked.',
        code: 'ACCOUNT_LOCKED',
        unlockTime
      });
    }
    
    next();
  } catch (error) {
    logger.error('Error checking account status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error.'
    });
  }
};

module.exports = {
  verifyToken,
  requireRole,
  optionalAuth,
  checkArticleAccess,
  loginLimiter,
  otpLimiter,
  blacklistToken,
  detectSuspiciousActivity,
  cleanupSessions,
  requireEmailVerification,
  checkAccountStatus,
  updateLastActivity
};