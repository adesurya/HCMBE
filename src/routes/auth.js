// src/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, loginLimiter } = require('../middleware/auth');
const { userValidation } = require('../middleware/validation');
const { fileUploadSecurity } = require('../middleware/security');
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

// Public routes
router.post('/register', userValidation.register, authController.register);
router.post('/login', loginLimiter, userValidation.login, authController.login);
router.post('/logout', authController.logout);
router.post('/refresh-token', authController.refreshToken);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);

// Protected routes
router.use(verifyToken);
router.get('/profile', authController.getProfile);
router.put('/profile', userValidation.update, authController.updateProfile);
router.post('/change-password', authController.changePassword);
router.post('/upload-avatar', upload.single('avatar'), fileUploadSecurity, authController.uploadProfileImage);
router.get('/check', authController.checkAuth);
router.get('/permissions', authController.getPermissions);

module.exports = router;

