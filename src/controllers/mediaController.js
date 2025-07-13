// src/controllers/mediaController.js
const mediaService = require('../services/mediaService');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Get all media
const getMedia = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    type,
    uploaded_by
  } = req.query;

  // Journalists can only see their own media
  const userId = req.user.role === 'journalist' ? req.user.id : 
                 (uploaded_by ? parseInt(uploaded_by) : null);

  const result = await mediaService.getAll(
    parseInt(page),
    parseInt(limit),
    userId,
    type
  );

  res.json({
    success: true,
    data: {
      media: result.media,
      pagination: result.pagination
    }
  });
});

// Get single media
const getMediaById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const media = await mediaService.getById(parseInt(id));

  if (!media) {
    throw new AppError('Media not found', 404);
  }

  // Check permissions for journalists
  if (req.user.role === 'journalist' && media.uploaded_by !== req.user.id) {
    throw new AppError('You can only access your own media', 403);
  }

  res.json({
    success: true,
    data: {
      media
    }
  });
});

// Upload single media file
const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const { alt_text, caption } = req.body;

  const result = await mediaService.processUpload(req.file, {
    userId: req.user.id,
    alt_text,
    caption,
    createResponsive: true,
    uploadToCDN: true
  });

  res.status(201).json({
    success: true,
    message: 'File uploaded successfully',
    data: {
      media: result
    }
  });
});

// Bulk upload media files
const bulkUploadMedia = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  const result = await mediaService.processBulkUpload(req.files, {
    userId: req.user.id,
    createResponsive: true,
    uploadToCDN: true
  });

  res.status(201).json({
    success: true,
    message: 'Files uploaded successfully',
    data: result
  });
});

// Update media metadata
const updateMedia = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { alt_text, caption } = req.body;

  const userId = req.user.role === 'journalist' ? req.user.id : null;

  const media = await mediaService.updateMetadata(
    parseInt(id),
    { alt_text, caption },
    userId
  );

  res.json({
    success: true,
    message: 'Media updated successfully',
    data: {
      media
    }
  });
});

// Delete media
const deleteMedia = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.role === 'journalist' ? req.user.id : null;

  await mediaService.delete(parseInt(id), userId);

  res.json({
    success: true,
    message: 'Media deleted successfully'
  });
});

// Get media usage statistics
const getMediaStats = asyncHandler(async (req, res) => {
  const userId = req.user.role === 'journalist' ? req.user.id : null;
  const stats = await mediaService.getUsageStats(userId);

  res.json({
    success: true,
    data: {
      stats
    }
  });
});

// Clean up unused media (admin only)
const cleanupUnusedMedia = asyncHandler(async (req, res) => {
  const { dry_run = true } = req.body;

  const result = await mediaService.cleanupUnusedMedia(dry_run === 'true');

  res.json({
    success: true,
    message: dry_run ? 'Cleanup preview completed' : 'Cleanup completed',
    data: result
  });
});

// Convert image to WebP format
const convertToWebP = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const media = await mediaService.convertToWebP(parseInt(id));

  res.json({
    success: true,
    message: 'Image converted to WebP successfully',
    data: {
      media
    }
  });
});

// Generate responsive image HTML
const generateResponsiveHtml = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { alt, className, sizes } = req.query;

  const media = await mediaService.getById(parseInt(id));
  if (!media) {
    throw new AppError('Media not found', 404);
  }

  const html = mediaService.generateResponsiveImageHtml(
    media,
    alt,
    className,
    sizes
  );

  res.json({
    success: true,
    data: {
      html
    }
  });
});

module.exports = {
  getMedia,
  getMediaById,
  uploadMedia,
  bulkUploadMedia,
  updateMedia,
  deleteMedia,
  getMediaStats,
  cleanupUnusedMedia,
  convertToWebP,
  generateResponsiveHtml
};