// src/config/multer.js
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads');
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// Memory storage for processing
const memoryStorage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
  // Check file type
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const allowedVideoTypes = /mp4|webm|ogg/;
  const allowedDocTypes = /pdf|doc|docx/;
  
  const extname = allowedImageTypes.test(path.extname(file.originalname).toLowerCase()) ||
                  allowedVideoTypes.test(path.extname(file.originalname).toLowerCase()) ||
                  allowedDocTypes.test(path.extname(file.originalname).toLowerCase());
  
  const mimetype = allowedImageTypes.test(file.mimetype) ||
                   allowedVideoTypes.test(file.mimetype) ||
                   allowedDocTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new AppError('Only images, videos, and documents are allowed', 400));
  }
};

// Multer configurations
const uploadConfig = {
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    files: 10, // Maximum 10 files
    fields: 20 // Maximum 20 fields
  }
};

const memoryUploadConfig = {
  storage: memoryStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
    files: 10,
    fields: 20
  }
};

// Create multer instances
const upload = multer(uploadConfig);
const memoryUpload = multer(memoryUploadConfig);

// Specific upload handlers
const uploadSingle = (fieldName) => upload.single(fieldName);
const uploadMultiple = (fieldName, maxCount = 10) => upload.array(fieldName, maxCount);
const uploadFields = (fields) => upload.fields(fields);

const memoryUploadSingle = (fieldName) => memoryUpload.single(fieldName);
const memoryUploadMultiple = (fieldName, maxCount = 10) => memoryUpload.array(fieldName, maxCount);

// Avatar upload (specific for user profiles)
const avatarUpload = multer({
  storage: memoryStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new AppError('Only image files are allowed for avatars', 400));
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB for avatars
  }
});

module.exports = {
  upload,
  memoryUpload,
  uploadSingle,
  uploadMultiple,
  uploadFields,
  memoryUploadSingle,
  memoryUploadMultiple,
  avatarUpload
};