// src/routes/media.js
const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { idValidation, paginationValidation } = require('../middleware/validation');
const { fileUploadSecurity, rateLimiters } = require('../middleware/security');
const multer = require('multer');

// Configure multer
const upload = multer({
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      ...process.env.ALLOWED_IMAGE_TYPES?.split(',') || [],
      ...process.env.ALLOWED_VIDEO_TYPES?.split(',') || []
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

// All routes require authentication
router.use(verifyToken);

// Get media
router.get('/', paginationValidation, mediaController.getMedia);
router.get('/:id', idValidation, mediaController.getMediaById);

// Upload media (rate limited)
router.post('/upload', rateLimiters.upload, upload.single('file'), fileUploadSecurity, mediaController.uploadMedia);
router.post('/bulk-upload', rateLimiters.upload, upload.array('files', 10), fileUploadSecurity, mediaController.bulkUploadMedia);

// Update media metadata
router.put('/:id', idValidation, mediaController.updateMedia);

// Delete media
router.delete('/:id', idValidation, mediaController.deleteMedia);

// Admin only routes
router.get('/admin/stats', requireRole(['admin']), mediaController.getMediaStats);
router.post('/admin/cleanup', requireRole(['admin']), mediaController.cleanupUnusedMedia);
router.post('/:id/convert-webp', requireRole(['admin']), idValidation, mediaController.convertToWebP);

module.exports = router;

