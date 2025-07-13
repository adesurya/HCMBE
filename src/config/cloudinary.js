// src/config/cloudinary.js - Fixed version
const cloudinary = require('cloudinary').v2;
const logger = require('../../scripts/baksrc/utils/logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Test connection
const testConnection = async () => {
  try {
    const result = await cloudinary.api.ping();
    logger.info('Cloudinary connection successful:', result);
    return true;
  } catch (error) {
    logger.error('Cloudinary connection failed:', error);
    return false;
  }
};

// Upload image with transformations
const uploadImage = async (filePath, options = {}) => {
  try {
    const {
      folder = 'news-portal',
      public_id,
      transformation = {},
      resource_type = 'image'
    } = options;

    const uploadOptions = {
      folder,
      resource_type,
      use_filename: true,
      unique_filename: !public_id,
      overwrite: false,
      transformation: {
        quality: 'auto:good',
        fetch_format: 'auto',
        ...transformation
      }
    };

    if (public_id) {
      uploadOptions.public_id = public_id;
    }

    const result = await cloudinary.uploader.upload(filePath, uploadOptions);
    return result;
  } catch (error) {
    logger.error('Cloudinary upload error:', error);
    throw error;
  }
};

// Delete image
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    logger.error('Cloudinary delete error:', error);
    throw error;
  }
};

// Generate optimized URL
const generateOptimizedUrl = (publicId, options = {}) => {
  try {
    const {
      width,
      height,
      crop = 'fill',
      quality = 'auto:good',
      format = 'auto'
    } = options;

    return cloudinary.url(publicId, {
      width,
      height,
      crop,
      quality,
      fetch_format: format,
      secure: true
    });
  } catch (error) {
    logger.error('Cloudinary URL generation error:', error);
    return null;
  }
};

module.exports = {
  cloudinary,
  testConnection,
  uploadImage,
  deleteImage,
  generateOptimizedUrl
};