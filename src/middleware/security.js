// src/middleware/security.js
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { body, validationResult } = require('express-validator');
const xss = require('xss');
const path = require('path');
const crypto = require('crypto');

// SQL Injection Protection
const sqlInjectionProtection = (req, res, next) => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
    /(\b(OR|AND)\b\s*\d+\s*=\s*\d+)/gi,
    /(\b(OR|AND)\b\s*\'\w+\'\s*=\s*\'\w+\')/gi,
    /(\b(OR|AND)\b\s*\"\w+\"\s*=\s*\"\w+\")/gi,
    /(--|#|\/\*|\*\/)/g,
    /(\b(UNION|SELECT)\b.*\b(FROM|WHERE)\b)/gi
  ];

  const checkForSQLInjection = (obj) => {
    if (typeof obj === 'string') {
      return sqlPatterns.some(pattern => pattern.test(obj));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      return Object.values(obj).some(value => checkForSQLInjection(value));
    }
    
    return false;
  };

  if (checkForSQLInjection(req.body) || checkForSQLInjection(req.query) || checkForSQLInjection(req.params)) {
    return res.status(400).json({
      success: false,
      error: 'Malicious input detected'
    });
  }

  next();
};

// XSS Protection
const xssProtection = (req, res, next) => {
  const sanitizeObject = (obj) => {
    if (typeof obj === 'string') {
      return xss(obj);
    }
    
    if (typeof obj === 'object' && obj !== null) {
      const sanitized = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }
    
    return obj;
  };

  req.body = sanitizeObject(req.body);
  req.query = sanitizeObject(req.query);
  req.params = sanitizeObject(req.params);

  next();
};

// File Upload Security
const fileUploadSecurity = (req, res, next) => {
  if (!req.files && !req.file) {
    return next();
  }

  const files = req.files ? (Array.isArray(req.files) ? req.files : [req.files]) : [req.file];
  
  const allowedImageTypes = process.env.ALLOWED_IMAGE_TYPES?.split(',') || ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const allowedVideoTypes = process.env.ALLOWED_VIDEO_TYPES?.split(',') || ['video/mp4', 'video/webm', 'video/ogg'];
  const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];
  
  const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // 10MB
  
  const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar', '.php', '.asp', '.aspx', '.jsp'];

  for (const file of files) {
    if (!file) continue;

    // Check file type
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: `File type ${file.mimetype} is not allowed`
      });
    }

    // Check file size
    if (file.size > maxFileSize) {
      return res.status(400).json({
        success: false,
        error: `File size exceeds maximum allowed size of ${maxFileSize / 1024 / 1024}MB`
      });
    }

    // Check for dangerous extensions
    const fileExtension = path.extname(file.originalname || file.name).toLowerCase();
    if (dangerousExtensions.includes(fileExtension)) {
      return res.status(400).json({
        success: false,
        error: 'File type not allowed'
      });
    }

    // Check for null bytes and path traversal
    const fileName = file.originalname || file.name;
    if (fileName.includes('\0') || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename'
      });
    }

    // Generate safe filename
    const safeFileName = crypto.randomBytes(16).toString('hex') + fileExtension;
    file.safeFileName = safeFileName;
  }

  next();
};

// CSRF Protection
const csrfProtection = (req, res, next) => {
  // Skip CSRF for GET requests and API endpoints with proper authentication
  if (req.method === 'GET' || req.path.startsWith('/api/')) {
    return next();
  }

  const token = req.headers['x-csrf-token'] || req.body._csrf;
  const sessionToken = req.session?.csrfToken;

  if (!token || !sessionToken || token !== sessionToken) {
    return res.status(403).json({
      success: false,
      error: 'CSRF token mismatch'
    });
  }

  next();
};

// Rate limiting configurations
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: message
      });
    }
  });
};

// Different rate limits for different endpoints
const rateLimiters = {
  // General API rate limiting
  general: createRateLimiter(15 * 60 * 1000, 100, 'Too many requests'),
  
  // Strict rate limiting for authentication
  auth: createRateLimiter(15 * 60 * 1000, 5, 'Too many authentication attempts'),
  
  // File upload rate limiting
  upload: createRateLimiter(60 * 60 * 1000, 10, 'Too many file uploads'),
  
  // Comment rate limiting
  comment: createRateLimiter(60 * 1000, 5, 'Too many comments'),
  
  // Search rate limiting
  search: createRateLimiter(60 * 1000, 20, 'Too many search requests')
};

// Speed limiting for repeated requests
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per windowMs without delay
  delayMs: 500, // add 500ms delay per request after delayAfter
  maxDelayMs: 5000, // maximum delay of 5 seconds
});

// IP-based security
const ipSecurity = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  
  // Block known malicious IPs (you can maintain a blacklist)
  const blacklistedIPs = process.env.BLACKLISTED_IPS?.split(',') || [];
  
  if (blacklistedIPs.includes(ip)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied'
    });
  }

  next();
};

// Request size limiting
const requestSizeLimiter = (req, res, next) => {
  const contentLength = req.headers['content-length'];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength && parseInt(contentLength) > maxSize) {
    return res.status(413).json({
      success: false,
      error: 'Request entity too large'
    });
  }

  next();
};

// Header security
const headerSecurity = (req, res, next) => {
  // Remove or modify sensitive headers
  delete req.headers['x-powered-by'];
  delete req.headers['server'];
  
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
};

// Content Security Policy
const contentSecurityPolicy = (req, res, next) => {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https:",
    "media-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  next();
};

// Request logging for security monitoring
const securityLogger = (req, res, next) => {
  const suspiciousPatterns = [
    /(\.\.|\/etc\/|\/var\/|\/usr\/|\/proc\/)/gi,
    /(\<script|\<iframe|\<object|\<embed)/gi,
    /(\bunion\b.*\bselect\b|\bselect\b.*\bunion\b)/gi,
    /(javascript:|data:|vbscript:)/gi
  ];

  const logSuspiciousRequest = (type, content) => {
    console.warn(`[SECURITY] Suspicious ${type} from IP ${req.ip}: ${content}`);
  };

  // Check URL for suspicious patterns
  if (suspiciousPatterns.some(pattern => pattern.test(req.url))) {
    logSuspiciousRequest('URL', req.url);
  }

  // Check headers for suspicious patterns
  Object.keys(req.headers).forEach(header => {
    if (suspiciousPatterns.some(pattern => pattern.test(req.headers[header]))) {
      logSuspiciousRequest('Header', `${header}: ${req.headers[header]}`);
    }
  });

  next();
};

module.exports = {
  sqlInjectionProtection,
  xssProtection,
  fileUploadSecurity,
  csrfProtection,
  rateLimiters,
  speedLimiter,
  ipSecurity,
  requestSizeLimiter,
  headerSecurity,
  contentSecurityPolicy,
  securityLogger
};