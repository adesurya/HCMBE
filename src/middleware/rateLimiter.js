// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const RedisStore = require('rate-limit-redis');
const redis = require('../config/redis');
const logger = require('../utils/logger');

// Custom key generator based on IP and user ID
const keyGenerator = (req) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.user?.id || 'anonymous';
  return `rate_limit:${ip}:${userId}`;
};

// Create Redis store for rate limiting (fallback to memory if Redis unavailable)
const createStore = () => {
  if (redis.isConnected) {
    return new RedisStore({
      sendCommand: (...args) => redis.client.sendCommand(args)
    });
  }
  logger.warn('Redis not available, using memory store for rate limiting');
  return undefined; // Use default memory store
};

// Enhanced rate limiter with progressive penalties
const createAdvancedRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = 'Too many requests from this IP, please try again later.',
    standardHeaders = true,
    legacyHeaders = false,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator: customKeyGenerator = keyGenerator
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: message
    },
    standardHeaders,
    legacyHeaders,
    store: createStore(),
    keyGenerator: customKeyGenerator,
    skipSuccessfulRequests,
    skipFailedRequests,
    handler: (req, res, next) => {
      logger.warn(`Rate limit exceeded for ${req.ip}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        userId: req.user?.id
      });
      
      res.status(429).json({
        success: false,
        error: message,
        retryAfter: Math.round(windowMs / 1000)
      });
    },
    onLimitReached: (req, res) => {
      logger.error(`Rate limit reached for ${req.ip}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        userId: req.user?.id
      });
    }
  });
};

// Adaptive rate limiter based on user role
const createRoleBasedRateLimiter = (limits) => {
  return (req, res, next) => {
    const userRole = req.user?.role || 'anonymous';
    const limit = limits[userRole] || limits.default || limits.anonymous;
    
    if (!limit) {
      return next();
    }

    const limiter = createAdvancedRateLimiter({
      windowMs: limit.windowMs,
      max: limit.max,
      message: limit.message || `Rate limit exceeded for ${userRole} users`
    });

    return limiter(req, res, next);
  };
};

// Specific rate limiters for different endpoints
const rateLimiters = {
  // General API rate limiting
  general: createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per window
    message: 'Too many API requests, please try again later.'
  }),

  // Authentication endpoints (stricter)
  auth: createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: 'Too many authentication attempts, please try again later.',
    skipSuccessfulRequests: true // Don't count successful logins
  }),

  // Login attempts (very strict)
  login: createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: 'Too many login attempts, please try again later.',
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      // Use email + IP for login attempts
      const ip = req.ip;
      const email = req.body?.email || 'unknown';
      return `login_limit:${ip}:${email}`;
    }
  }),

  // Password reset
  passwordReset: createAdvancedRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset attempts per hour
    message: 'Too many password reset attempts, please try again later.'
  }),

  // Registration
  register: createAdvancedRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour per IP
    message: 'Too many registration attempts, please try again later.'
  }),

  // File upload
  upload: createAdvancedRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 uploads per hour
    message: 'Too many file uploads, please try again later.'
  }),

  // Comment posting
  comment: createAdvancedRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 comments per minute
    message: 'You are posting comments too frequently, please slow down.'
  }),

  // Search requests
  search: createAdvancedRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 searches per minute
    message: 'Too many search requests, please try again later.'
  }),

  // Email sending
  email: createAdvancedRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 emails per hour
    message: 'Too many email requests, please try again later.'
  }),

  // API key requests
  apiKey: createAdvancedRateLimiter({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 3, // 3 API key requests per day
    message: 'Too many API key requests, please try again tomorrow.'
  }),

  // Role-based rate limiting
  roleBasedApi: createRoleBasedRateLimiter({
    admin: {
      windowMs: 15 * 60 * 1000,
      max: 10000, // Very high limit for admins
      message: 'Admin rate limit exceeded'
    },
    editor: {
      windowMs: 15 * 60 * 1000,
      max: 5000, // High limit for editors
      message: 'Editor rate limit exceeded'
    },
    journalist: {
      windowMs: 15 * 60 * 1000,
      max: 2000, // Medium limit for journalists
      message: 'Journalist rate limit exceeded'
    },
    user: {
      windowMs: 15 * 60 * 1000,
      max: 1000, // Standard limit for users
      message: 'User rate limit exceeded'
    },
    anonymous: {
      windowMs: 15 * 60 * 1000,
      max: 100, // Low limit for anonymous users
      message: 'Anonymous user rate limit exceeded'
    }
  })
};

// Speed limiter to add delays for repeated requests
const speedLimiters = {
  // General speed limiting
  general: slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 100, // Allow 100 requests per window without delay
    delayMs: 500, // Add 500ms delay per request after delayAfter
    maxDelayMs: 10000, // Maximum delay of 10 seconds
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
    keyGenerator
  }),

  // API speed limiting
  api: slowDown({
    windowMs: 15 * 60 * 1000,
    delayAfter: 200,
    delayMs: 250,
    maxDelayMs: 5000,
    keyGenerator
  }),

  // Search speed limiting
  search: slowDown({
    windowMs: 60 * 1000, // 1 minute
    delayAfter: 10, // Allow 10 searches per minute without delay
    delayMs: 1000, // Add 1 second delay after that
    maxDelayMs: 5000,
    keyGenerator
  })
};

// Progressive penalty system
const createProgressiveLimiter = (baseOptions) => {
  return async (req, res, next) => {
    const key = keyGenerator(req);
    const penaltyKey = `penalty:${key}`;
    
    try {
      // Get current penalty level
      const penaltyLevel = await redis.get(penaltyKey) || 0;
      
      // Adjust limits based on penalty level
      const adjustedMax = Math.max(1, baseOptions.max - (penaltyLevel * 10));
      const adjustedWindowMs = baseOptions.windowMs + (penaltyLevel * 60000); // Add 1 minute per penalty level
      
      const limiter = createAdvancedRateLimiter({
        ...baseOptions,
        max: adjustedMax,
        windowMs: adjustedWindowMs,
        handler: async (req, res, next) => {
          // Increase penalty level on rate limit hit
          await redis.incr(penaltyKey, 24 * 60 * 60); // Expire after 24 hours
          
          logger.warn(`Progressive penalty applied to ${req.ip}`, {
            ip: req.ip,
            penaltyLevel: penaltyLevel + 1,
            path: req.path
          });
          
          res.status(429).json({
            success: false,
            error: 'Rate limit exceeded. Continued violations will result in longer restrictions.',
            penaltyLevel: penaltyLevel + 1,
            retryAfter: Math.round(adjustedWindowMs / 1000)
          });
        }
      });
      
      return limiter(req, res, next);
    } catch (error) {
      logger.error('Progressive limiter error:', error);
      // Fallback to basic rate limiting
      const fallbackLimiter = createAdvancedRateLimiter(baseOptions);
      return fallbackLimiter(req, res, next);
    }
  };
};

// Suspicious activity detector
const suspiciousActivityLimiter = createAdvancedRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 200, // 200 requests in 5 minutes triggers suspicious activity
  message: 'Suspicious activity detected. Please contact support if this is an error.',
  keyGenerator: (req) => `suspicious:${req.ip}`,
  handler: (req, res, next) => {
    logger.error(`Suspicious activity detected from ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });
    
    // Could trigger additional security measures here
    // like temporary IP blocking, CAPTCHA requirements, etc.
    
    res.status(429).json({
      success: false,
      error: 'Suspicious activity detected. Your IP has been temporarily restricted.',
      contact: 'Please contact support if you believe this is an error.'
    });
  }
});

// Whitelist middleware to bypass rate limiting for certain IPs or users
const createWhitelistMiddleware = (whitelist = []) => {
  return (req, res, next) => {
    const ip = req.ip;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    // Check IP whitelist
    if (whitelist.ips && whitelist.ips.includes(ip)) {
      return next();
    }
    
    // Check user ID whitelist
    if (whitelist.userIds && userId && whitelist.userIds.includes(userId)) {
      return next();
    }
    
    // Check role whitelist
    if (whitelist.roles && userRole && whitelist.roles.includes(userRole)) {
      return next();
    }
    
    // Apply rate limiting
    return rateLimiters.general(req, res, next);
  };
};

// Dynamic rate limiter that adjusts based on server load
const createDynamicRateLimiter = (baseOptions) => {
  return (req, res, next) => {
    // Simple server load check (you could implement more sophisticated monitoring)
    const loadAverage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    
    // Calculate load factor (simplified)
    const loadFactor = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    let adjustedMax = baseOptions.max;
    
    if (loadFactor > 80) {
      adjustedMax = Math.floor(baseOptions.max * 0.5); // Reduce by 50% if high load
    } else if (loadFactor > 60) {
      adjustedMax = Math.floor(baseOptions.max * 0.75); // Reduce by 25% if medium load
    }
    
    const limiter = createAdvancedRateLimiter({
      ...baseOptions,
      max: adjustedMax
    });
    
    return limiter(req, res, next);
  };
};

// Rate limiter for different HTTP methods
const createMethodBasedLimiter = (methodLimits) => {
  return (req, res, next) => {
    const method = req.method.toLowerCase();
    const limit = methodLimits[method] || methodLimits.default;
    
    if (!limit) {
      return next();
    }
    
    const limiter = createAdvancedRateLimiter(limit);
    return limiter(req, res, next);
  };
};

// Export rate limiters and utilities
module.exports = {
  rateLimiters,
  speedLimiters,
  createAdvancedRateLimiter,
  createRoleBasedRateLimiter,
  createProgressiveLimiter,
  createWhitelistMiddleware,
  createDynamicRateLimiter,
  createMethodBasedLimiter,
  suspiciousActivityLimiter,
  
  // Specific limiters for common use cases
  strictAuth: rateLimiters.auth,
  strictLogin: rateLimiters.login,
  generalApi: rateLimiters.general,
  fileUpload: rateLimiters.upload,
  searchRequests: rateLimiters.search,
  commentPosting: rateLimiters.comment,
  
  // Utility functions
  keyGenerator,
  createStore
};