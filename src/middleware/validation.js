// src/middleware/validation.js
const { body, param, query, validationResult } = require('express-validator');
const xss = require('xss');
const sanitizeHtml = require('sanitize-html');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  
  next();
};

// Sanitize input data
const sanitizeInput = (req, res, next) => {
  // Sanitize body
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    });
  }
  
  // Sanitize query parameters
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = xss(req.query[key]);
      }
    });
  }
  
  next();
};

// User validation rules
const userValidation = {
  register: [
    body('username')
      .trim()
      .isLength({ min: 3, max: 50 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username must be 3-50 characters long and contain only letters, numbers, and underscores'),
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('first_name')
      .trim()
      .isLength({ min: 2, max: 100 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('First name must be 2-100 characters long and contain only letters'),
    body('last_name')
      .trim()
      .isLength({ min: 2, max: 100 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Last name must be 2-100 characters long and contain only letters'),
    body('role')
      .optional()
      .isIn(['admin', 'editor', 'journalist', 'user'])
      .withMessage('Invalid role specified'),
    handleValidationErrors
  ],
  
  login: [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
    handleValidationErrors
  ],
  
  update: [
    body('username')
      .optional()
      .trim()
      .isLength({ min: 3, max: 50 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username must be 3-50 characters long and contain only letters, numbers, and underscores'),
    body('email')
      .optional()
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('first_name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('First name must be 2-100 characters long and contain only letters'),
    body('last_name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Last name must be 2-100 characters long and contain only letters'),
    handleValidationErrors
  ]
};

// Article validation rules
const articleValidation = {
  create: [
    body('title')
      .trim()
      .isLength({ min: 10, max: 255 })
      .withMessage('Title must be between 10 and 255 characters'),
    body('content')
      .trim()
      .isLength({ min: 50 })
      .withMessage('Content must be at least 50 characters long')
      .customSanitizer(value => {
        return sanitizeHtml(value, {
          allowedTags: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre'],
          allowedAttributes: {
            'a': ['href', 'title', 'target'],
            'img': ['src', 'alt', 'title', 'width', 'height'],
            'p': ['class'],
            'span': ['class'],
            'div': ['class']
          },
          allowedSchemes: ['http', 'https', 'mailto']
        });
      }),
    body('excerpt')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Excerpt must not exceed 500 characters'),
    body('category_id')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Category ID must be a positive integer'),
    body('meta_title')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Meta title must not exceed 255 characters'),
    body('meta_description')
      .optional()
      .trim()
      .isLength({ max: 160 })
      .withMessage('Meta description must not exceed 160 characters'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array'),
    body('tags.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Tag IDs must be positive integers'),
    handleValidationErrors
  ],
  
  update: [
    body('title')
      .optional()
      .trim()
      .isLength({ min: 10, max: 255 })
      .withMessage('Title must be between 10 and 255 characters'),
    body('content')
      .optional()
      .trim()
      .isLength({ min: 50 })
      .withMessage('Content must be at least 50 characters long')
      .customSanitizer(value => {
        return sanitizeHtml(value, {
          allowedTags: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre'],
          allowedAttributes: {
            'a': ['href', 'title', 'target'],
            'img': ['src', 'alt', 'title', 'width', 'height'],
            'p': ['class'],
            'span': ['class'],
            'div': ['class']
          },
          allowedSchemes: ['http', 'https', 'mailto']
        });
      }),
    body('excerpt')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Excerpt must not exceed 500 characters'),
    body('category_id')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Category ID must be a positive integer'),
    body('status')
      .optional()
      .isIn(['draft', 'ready_to_post', 'published', 'archived'])
      .withMessage('Invalid status'),
    handleValidationErrors
  ]
};

// Category validation rules
const categoryValidation = {
  create: [
    body('name')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Category name must be between 2 and 100 characters'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('parent_id')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Parent ID must be a positive integer'),
    handleValidationErrors
  ],
  
  update: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Category name must be between 2 and 100 characters'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('parent_id')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Parent ID must be a positive integer'),
    handleValidationErrors
  ]
};

// Tag validation rules
const tagValidation = {
  create: [
    body('name')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Tag name must be between 2 and 100 characters'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('color')
      .optional()
      .matches(/^#[0-9A-Fa-f]{6}$/)
      .withMessage('Color must be a valid hex color code'),
    handleValidationErrors
  ],
  
  update: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Tag name must be between 2 and 100 characters'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('color')
      .optional()
      .matches(/^#[0-9A-Fa-f]{6}$/)
      .withMessage('Color must be a valid hex color code'),
    handleValidationErrors
  ]
};

// Comment validation rules
const commentValidation = {
  create: [
    body('content')
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Comment must be between 10 and 1000 characters'),
    body('author_name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Author name must be between 2 and 100 characters'),
    body('author_email')
      .optional()
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('parent_id')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Parent ID must be a positive integer'),
    handleValidationErrors
  ]
};

// Ads validation rules
const adsValidation = {
  create: [
    body('title')
      .trim()
      .isLength({ min: 5, max: 255 })
      .withMessage('Title must be between 5 and 255 characters'),
    body('type')
      .isIn(['banner', 'inline', 'popup', 'native'])
      .withMessage('Invalid ad type'),
    body('position')
      .isIn(['header', 'footer', 'sidebar', 'inline_article', 'between_articles'])
      .withMessage('Invalid ad position'),
    body('content')
      .optional()
      .trim()
      .isLength({ max: 5000 })
      .withMessage('Content must not exceed 5000 characters'),
    body('link_url')
      .optional()
      .isURL()
      .withMessage('Please provide a valid URL'),
    body('width')
      .optional()
      .isInt({ min: 1, max: 2000 })
      .withMessage('Width must be between 1 and 2000 pixels'),
    body('height')
      .optional()
      .isInt({ min: 1, max: 2000 })
      .withMessage('Height must be between 1 and 2000 pixels'),
    handleValidationErrors
  ]
};

// Generic ID validation
const idValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID must be a positive integer'),
  handleValidationErrors
];

// Pagination validation
const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

// Search validation
const searchValidation = [
  query('q')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be between 2 and 100 characters'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  sanitizeInput,
  userValidation,
  articleValidation,
  categoryValidation,
  tagValidation,
  commentValidation,
  adsValidation,
  idValidation,
  paginationValidation,
  searchValidation
};