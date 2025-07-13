// src/routes/auth.js - Enhanced with OTP endpoints
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');
const { userValidation } = require('../middleware/validation');
const { fileUploadSecurity, rateLimiters } = require('../middleware/security');
const { body, validationResult } = require('express-validator');
const multer = require('multer');

// Configure multer for profile image uploads
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Validation middleware for OTP endpoints
const otpValidation = [
  body('otpToken')
    .notEmpty()
    .withMessage('OTP token is required')
    .isLength({ min: 64, max: 64 })
    .withMessage('Invalid OTP token format'),
  body('otp')
    .notEmpty()
    .withMessage('OTP is required')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits')
    .isNumeric()
    .withMessage('OTP must contain only numbers'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
    next();
  }
];

// Validation for resend OTP
const resendOTPValidation = [
  body('otpToken')
    .notEmpty()
    .withMessage('OTP token is required')
    .isLength({ min: 64, max: 64 })
    .withMessage('Invalid OTP token format'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
    next();
  }
];

// Enhanced login validation
const loginValidation = [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1 })
    .withMessage('Password cannot be empty'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
    next();
  }
];

// Public routes - Authentication Flow

// Step 1: Initial login (username/password verification)
router.post('/login', 
  rateLimiters.auth, 
  loginValidation, 
  authController.login
);

// Step 2: Verify OTP and complete login
router.post('/verify-otp', 
  rateLimiters.auth,
  otpValidation,
  authController.verifyOTPAndLogin
);

// Resend OTP for login
router.post('/resend-otp',
  rateLimiters.auth,
  resendOTPValidation,
  authController.resendOTP
);

// Other authentication endpoints
router.post('/register', 
  rateLimiters.auth,
  userValidation.register, 
  authController.register
);

router.post('/logout', authController.logout);

router.post('/refresh-token', authController.refreshToken);

router.post('/forgot-password', 
  rateLimiters.auth,
  [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }
      next();
    }
  ],
  authController.forgotPassword
);

router.post('/reset-password', 
  rateLimiters.auth,
  [
    body('token')
      .notEmpty()
      .withMessage('Reset token is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }
      next();
    }
  ],
  authController.resetPassword
);

router.get('/verify-email/:token', authController.verifyEmail);

router.post('/resend-verification', 
  rateLimiters.auth,
  [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }
      next();
    }
  ],
  authController.resendVerification
);

// Protected routes - require authentication
router.use(verifyToken);

router.get('/profile', authController.getProfile);

router.put('/profile', 
  userValidation.update, 
  authController.updateProfile
);

router.post('/change-password',
  [
    body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }
      next();
    }
  ],
  authController.changePassword
);

router.post('/upload-avatar', 
  upload.single('avatar'), 
  fileUploadSecurity, 
  authController.uploadProfileImage
);

router.get('/check', authController.checkAuth);

router.get('/permissions', authController.getPermissions);

// Health check endpoint for authentication service
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Authentication service is healthy',
    timestamp: new Date().toISOString(),
    features: {
      twoFactorAuth: true,
      emailVerification: true,
      passwordReset: true,
      sessionManagement: true
    }
  });
});

module.exports = router;