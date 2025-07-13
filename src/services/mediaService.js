// src/services/mediaService.js
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

class MediaService {
  constructor() {
    this.uploadPath = process.env.UPLOAD_PATH || './uploads';
    this.cdnEnabled = process.env.CDN_ENABLED === 'true';
    this.webpEnabled = process.env.WEBP_ENABLED === 'true';
    this.webpQuality = parseInt(process.env.WEBP_QUALITY) || 80;
  }

  // Generate unique filename
  generateFileName(originalName, extension) {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(8).toString('hex');
    const sanitizedName = originalName
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .substring(0, 50);
    
    return `${timestamp}_${randomBytes}_${sanitizedName}${extension}`;
  }

  // Get image dimensions and metadata
  async getImageMetadata(filePath) {
    try {
      const metadata = await sharp(filePath).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: metadata.size,
        hasAlpha: metadata.hasAlpha,
        channels: metadata.channels
      };
    } catch (error) {
      logger.error('Error getting image metadata:', error);
      throw new AppError('Failed to process image metadata', 500);
    }
  }

  // Optimize image with Sharp
  async optimizeImage(inputPath, outputPath, options = {}) {
    try {
      const {
        width = null,
        height = null,
        quality = 85,
        format = null,
        progressive = true,
        removeMetadata = true
      } = options;

      let pipeline = sharp(inputPath);

      // Remove metadata for privacy and size reduction
      if (removeMetadata) {
        pipeline = pipeline.withMetadata(false);
      }

      // Resize if dimensions provided
      if (width || height) {
        pipeline = pipeline.resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Set format and quality
      if (format === 'webp' || this.webpEnabled) {
        pipeline = pipeline.webp({ 
          quality: this.webpQuality,
          progressive 
        });
      } else if (format === 'jpeg' || format === 'jpg') {
        pipeline = pipeline.jpeg({ 
          quality,
          progressive,
          mozjpeg: true 
        });
      } else if (format === 'png') {
        pipeline = pipeline.png({ 
          quality,
          progressive: true,
          compressionLevel: 9 
        });
      }

      await pipeline.toFile(outputPath);

      return await this.getImageMetadata(outputPath);
    } catch (error) {
      logger.error('Error optimizing image:', error);
      throw new AppError('Failed to optimize image', 500);
    }
  }

  // Create responsive image sizes
  async createResponsiveSizes(inputPath, baseName, outputDir) {
    const sizes = [
      { suffix: '_thumbnail', width: 150, height: 150 },
      { suffix: '_small', width: 300, height: null },
      { suffix: '_medium', width: 600, height: null },
      { suffix: '_large', width: 1200, height: null },
      { suffix: '_xlarge', width: 1920, height: null }
    ];

    const responsiveSizes = {};
    const originalExt = path.extname(baseName);
    const baseName_ = path.basename(baseName, originalExt);

    for (const size of sizes) {
      const outputPath = path.join(outputDir, `${baseName_}${size.suffix}${originalExt}`);
      
      try {
        const metadata = await this.optimizeImage(inputPath, outputPath, {
          width: size.width,
          height: size.height,
          format: this.webpEnabled ? 'webp' : null
        });

        responsiveSizes[size.suffix.substring(1)] = {
          path: outputPath,
          url: outputPath.replace(this.uploadPath, ''),
          width: metadata.width,
          height: metadata.height,
          size: metadata.size
        };
      } catch (error) {
        logger.error(`Error creating ${size.suffix} size:`, error);
      }
    }

    return responsiveSizes;
  }

  // Upload to CDN (Cloudinary)
  async uploadToCDN(filePath, options = {}) {
    if (!this.cdnEnabled) {
      return null;
    }

    try {
      const {
        folder = 'news-portal',
        public_id = null,
        transformation = null,
        resource_type = 'auto'
      } = options;

      const uploadOptions = {
        folder,
        resource_type,
        use_filename: true,
        unique_filename: !public_id,
        overwrite: false
      };

      if (public_id) {
        uploadOptions.public_id = public_id;
      }

      if (transformation) {
        uploadOptions.transformation = transformation;
      }

      const result = await cloudinary.uploader.upload(filePath, uploadOptions);

      return {
        public_id: result.public_id,
        version: result.version,
        signature: result.signature,
        width: result.width,
        height: result.height,
        format: result.format,
        resource_type: result.resource_type,
        url: result.secure_url,
        bytes: result.bytes
      };
    } catch (error) {
      logger.error('CDN upload error:', error);
      throw new AppError('Failed to upload to CDN', 500);
    }
  }

  // Process uploaded file
  async processUpload(file, options = {}) {
    try {
      const {
        userId,
        createResponsive = true,
        uploadToCDN = this.cdnEnabled,
        alt_text = '',
        caption = ''
      } = options;

      // Validate file
      if (!file) {
        throw new AppError('No file provided', 400);
      }

      // Create directories
      const uploadDir = path.join(this.uploadPath, 'images');
      const tempDir = path.join(this.uploadPath, 'temp');
      
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.mkdir(tempDir, { recursive: true });

      // Generate filename
      const originalExt = path.extname(file.originalname);
      const fileName = this.generateFileName(file.originalname, originalExt);
      const tempPath = path.join(tempDir, fileName);
      const finalPath = path.join(uploadDir, fileName);

      // Save uploaded file temporarily
      await fs.writeFile(tempPath, file.buffer);

      // Get original metadata
      const originalMetadata = await this.getImageMetadata(tempPath);

      // Optimize main image
      const optimizedMetadata = await this.optimizeImage(tempPath, finalPath, {
        quality: 85,
        format: this.webpEnabled ? 'webp' : null
      });

      // Calculate compression ratio
      const compressionRatio = ((originalMetadata.size - optimizedMetadata.size) / originalMetadata.size * 100).toFixed(2);

      // Create responsive sizes if requested
      let responsiveSizes = {};
      if (createResponsive) {
        responsiveSizes = await this.createResponsiveSizes(finalPath, fileName, uploadDir);
      }

      // Upload to CDN if enabled
      let cdnData = null;
      if (uploadToCDN) {
        cdnData = await this.uploadToCDN(finalPath, {
          folder: 'news-portal/images',
          transformation: [
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
          ]
        });
      }

      // Save to database
      const [result] = await db.execute(
        `INSERT INTO media (
          filename, original_name, mime_type, size, width, height,
          path, url, cdn_url, alt_text, caption, uploaded_by,
          is_optimized, compression_ratio
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileName,
          file.originalname,
          file.mimetype,
          optimizedMetadata.size,
          optimizedMetadata.width,
          optimizedMetadata.height,
          finalPath,
          `/uploads/images/${fileName}`,
          cdnData?.url || null,
          alt_text,
          caption,
          userId,
          true,
          parseFloat(compressionRatio)
        ]
      );

      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch (error) {
        logger.warn('Failed to delete temp file:', tempPath);
      }

      return {
        id: result.insertId,
        filename: fileName,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size: optimizedMetadata.size,
        width: optimizedMetadata.width,
        height: optimizedMetadata.height,
        url: `/uploads/images/${fileName}`,
        cdn_url: cdnData?.url || null,
        alt_text,
        caption,
        compression_ratio: parseFloat(compressionRatio),
        responsive_sizes: responsiveSizes,
        cdn_data: cdnData
      };
    } catch (error) {
      logger.error('Error processing upload:', error);
      throw error;
    }
  }

  // Get media by ID
  async getById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM media WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  // Get all media with pagination
  async getAll(page = 1, limit = 20, userId = null, mimeType = null) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (userId) {
      conditions.push('uploaded_by = ?');
      params.push(userId);
    }

    if (mimeType) {
      conditions.push('mime_type LIKE ?');
      params.push(`${mimeType}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT m.*, u.username as uploaded_by_name
      FROM media m
      LEFT JOIN users u ON m.uploaded_by = u.id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM media m
      ${whereClause}
    `;

    const [rows] = await db.execute(query, [...params, limit, offset]);
    const [countRows] = await db.execute(countQuery, params);

    return {
      media: rows,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / limit)
      }
    };
  }

  // Delete media
  async delete(id, userId = null) {
    const media = await this.getById(id);
    if (!media) {
      throw new AppError('Media not found', 404);
    }

    // Check if user owns the media (for non-admin users)
    if (userId && media.uploaded_by !== userId) {
      throw new AppError('You can only delete your own media', 403);
    }

    // Delete from CDN if exists
    if (media.cdn_url && this.cdnEnabled) {
      try {
        // Extract public_id from CDN URL
        const urlParts = media.cdn_url.split('/');
        const publicIdWithExt = urlParts.slice(-2).join('/'); // folder/filename
        const publicId = publicIdWithExt.split('.')[0]; // remove extension
        
        await cloudinary.uploader.destroy(publicId);
      } catch (error) {
        logger.error('Error deleting from CDN:', error);
      }
    }

    // Delete local files
    try {
      if (media.path && await fs.access(media.path).then(() => true).catch(() => false)) {
        await fs.unlink(media.path);
      }

      // Delete responsive sizes
      const uploadDir = path.dirname(media.path);
      const baseName = path.basename(media.filename, path.extname(media.filename));
      const sizes = ['_thumbnail', '_small', '_medium', '_large', '_xlarge'];

      for (const size of sizes) {
        const sizePath = path.join(uploadDir, `${baseName}${size}${path.extname(media.filename)}`);
        try {
          await fs.unlink(sizePath);
        } catch (error) {
          // File might not exist, ignore error
        }
      }
    } catch (error) {
      logger.error('Error deleting local files:', error);
    }

    // Delete from database
    await db.execute('DELETE FROM media WHERE id = ?', [id]);

    return true;
  }

  // Update media metadata
  async updateMetadata(id, updates, userId = null) {
    const media = await this.getById(id);
    if (!media) {
      throw new AppError('Media not found', 404);
    }

    // Check if user owns the media (for non-admin users)
    if (userId && media.uploaded_by !== userId) {
      throw new AppError('You can only update your own media', 403);
    }

    const allowedUpdates = ['alt_text', 'caption'];
    const updateFields = [];
    const updateValues = [];

    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key) && updates[key] !== undefined) {
        updateFields.push(`${key} = ?`);
        updateValues.push(updates[key]);
      }
    });

    if (updateFields.length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    updateValues.push(id);

    await db.execute(
      `UPDATE media SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    return await this.getById(id);
  }

  // Generate optimized URL for different sizes
  generateOptimizedUrl(media, size = 'medium', format = null) {
    if (media.cdn_url && this.cdnEnabled) {
      // Use Cloudinary transformations
      const transformations = [];
      
      switch (size) {
        case 'thumbnail':
          transformations.push('w_150,h_150,c_fill');
          break;
        case 'small':
          transformations.push('w_300,c_scale');
          break;
        case 'medium':
          transformations.push('w_600,c_scale');
          break;
        case 'large':
          transformations.push('w_1200,c_scale');
          break;
        case 'xlarge':
          transformations.push('w_1920,c_scale');
          break;
        default:
          transformations.push('w_600,c_scale');
      }

      // Add format transformation
      if (format) {
        transformations.push(`f_${format}`);
      } else if (this.webpEnabled) {
        transformations.push('f_auto');
      }

      // Add quality optimization
      transformations.push('q_auto:good');

      const baseUrl = media.cdn_url.split('/upload/')[0];
      const imagePath = media.cdn_url.split('/upload/')[1];
      
      return `${baseUrl}/upload/${transformations.join(',')}/${imagePath}`;
    }

    // Use local files
    const ext = path.extname(media.filename);
    const baseName = path.basename(media.filename, ext);
    const sizeExt = size === 'original' ? '' : `_${size}`;
    
    return `/uploads/images/${baseName}${sizeExt}${ext}`;
  }

  // Get media usage statistics
  async getUsageStats(userId = null) {
    const userCondition = userId ? 'WHERE uploaded_by = ?' : '';
    const params = userId ? [userId] : [];

    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total_files,
        SUM(size) as total_size,
        AVG(size) as avg_size,
        COUNT(CASE WHEN mime_type LIKE 'image%' THEN 1 END) as image_count,
        COUNT(CASE WHEN mime_type LIKE 'video%' THEN 1 END) as video_count,
        AVG(compression_ratio) as avg_compression,
        SUM(CASE WHEN is_optimized = 1 THEN 1 ELSE 0 END) as optimized_count
      FROM media 
      ${userCondition}
    `, params);

    return stats[0];
  }

  // Clean up unused media files
  async cleanupUnusedMedia(dryRun = true) {
    // Find media files not referenced in articles
    const [unusedMedia] = await db.execute(`
      SELECT m.* FROM media m
      LEFT JOIN articles a ON m.url = a.featured_image OR a.content LIKE CONCAT('%', m.url, '%')
      WHERE a.id IS NULL
        AND m.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

    if (dryRun) {
      return {
        count: unusedMedia.length,
        totalSize: unusedMedia.reduce((sum, media) => sum + media.size, 0),
        files: unusedMedia.map(m => ({ id: m.id, filename: m.filename, size: m.size }))
      };
    }

    // Actually delete unused media
    let deletedCount = 0;
    let deletedSize = 0;

    for (const media of unusedMedia) {
      try {
        await this.delete(media.id);
        deletedCount++;
        deletedSize += media.size;
      } catch (error) {
        logger.error(`Failed to delete unused media ${media.id}:`, error);
      }
    }

    return {
      deletedCount,
      deletedSize,
      totalChecked: unusedMedia.length
    };
  }

  // Bulk upload processing
  async processBulkUpload(files, options = {}) {
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        const result = await this.processUpload(file, options);
        results.push(result);
      } catch (error) {
        errors.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

    return {
      successful: results,
      failed: errors,
      summary: {
        total: files.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }

  // Generate responsive image HTML
  generateResponsiveImageHtml(media, alt = '', className = '', sizes = null) {
    if (!media) return '';

    const defaultSizes = sizes || '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw';
    
    if (media.cdn_url && this.cdnEnabled) {
      // Generate srcset with Cloudinary transformations
      const srcset = [
        `${this.generateOptimizedUrl(media, 'small')} 300w`,
        `${this.generateOptimizedUrl(media, 'medium')} 600w`,
        `${this.generateOptimizedUrl(media, 'large')} 1200w`,
        `${this.generateOptimizedUrl(media, 'xlarge')} 1920w`
      ].join(', ');

      return `<img 
        src="${this.generateOptimizedUrl(media, 'medium')}" 
        srcset="${srcset}" 
        sizes="${defaultSizes}"
        alt="${alt || media.alt_text || ''}" 
        width="${media.width}" 
        height="${media.height}"
        class="${className}"
        loading="lazy"
      />`;
    }

    // Local files fallback
    return `<img 
      src="${media.url}" 
      alt="${alt || media.alt_text || ''}" 
      width="${media.width}" 
      height="${media.height}"
      class="${className}"
      loading="lazy"
    />`;
  }

  // Convert images to WebP format
  async convertToWebP(mediaId) {
    const media = await this.getById(mediaId);
    if (!media) {
      throw new AppError('Media not found', 404);
    }

    if (!media.mime_type.startsWith('image/')) {
      throw new AppError('Only images can be converted to WebP', 400);
    }

    const inputPath = media.path;
    const outputPath = inputPath.replace(path.extname(inputPath), '.webp');

    try {
      await sharp(inputPath)
        .webp({ quality: this.webpQuality })
        .toFile(outputPath);

      const newMetadata = await this.getImageMetadata(outputPath);
      const newUrl = media.url.replace(path.extname(media.url), '.webp');

      // Update database
      await db.execute(
        `UPDATE media SET 
          filename = ?, path = ?, url = ?, mime_type = 'image/webp',
          size = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          path.basename(outputPath),
          outputPath,
          newUrl,
          newMetadata.size,
          mediaId
        ]
      );

      // Delete original file
      try {
        await fs.unlink(inputPath);
      } catch (error) {
        logger.warn('Failed to delete original file:', inputPath);
      }

      return await this.getById(mediaId);
    } catch (error) {
      logger.error('Error converting to WebP:', error);
      throw new AppError('Failed to convert image to WebP', 500);
    }
  }

  // Regenerate responsive sizes for existing media
  async regenerateResponsiveSizes(mediaId) {
    const media = await this.getById(mediaId);
    if (!media) {
      throw new AppError('Media not found', 404);
    }

    if (!media.mime_type.startsWith('image/')) {
      throw new AppError('Only images support responsive sizes', 400);
    }

    const outputDir = path.dirname(media.path);
    const responsiveSizes = await this.createResponsiveSizes(
      media.path, 
      media.filename, 
      outputDir
    );

    return {
      mediaId,
      responsiveSizes,
      message: 'Responsive sizes regenerated successfully'
    };
  }
}

module.exports = new MediaService();