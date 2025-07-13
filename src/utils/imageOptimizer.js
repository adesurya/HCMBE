// src/utils/imageOptimizer.js
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class ImageOptimizer {
  constructor() {
    this.supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'svg'];
    this.defaultQuality = 85;
    this.webpQuality = 80;
  }

  // Check if file is an image
  isImage(mimetype) {
    return mimetype && mimetype.startsWith('image/');
  }

  // Get image info
  async getImageInfo(inputPath) {
    try {
      const metadata = await sharp(inputPath).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: metadata.size,
        hasAlpha: metadata.hasAlpha,
        channels: metadata.channels,
        density: metadata.density
      };
    } catch (error) {
      logger.error('Error getting image info:', error);
      throw new Error('Failed to read image metadata');
    }
  }

  // Optimize image
  async optimizeImage(inputPath, outputPath, options = {}) {
    try {
      const {
        quality = this.defaultQuality,
        width = null,
        height = null,
        format = null,
        progressive = true,
        removeMetadata = true,
        sharpen = false,
        blur = false
      } = options;

      let pipeline = sharp(inputPath);

      // Remove metadata if requested
      if (removeMetadata) {
        pipeline = pipeline.withMetadata({});
      }

      // Resize if dimensions provided
      if (width || height) {
        pipeline = pipeline.resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true,
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        });
      }

      // Apply filters
      if (sharpen) {
        pipeline = pipeline.sharpen();
      }

      if (blur && typeof blur === 'number') {
        pipeline = pipeline.blur(blur);
      }

      // Set output format and quality
      const outputFormat = format || path.extname(outputPath).slice(1).toLowerCase();
      
      switch (outputFormat) {
        case 'jpeg':
        case 'jpg':
          pipeline = pipeline.jpeg({
            quality,
            progressive,
            mozjpeg: true
          });
          break;
        
        case 'png':
          pipeline = pipeline.png({
            quality,
            progressive: true,
            compressionLevel: 9,
            adaptiveFiltering: true
          });
          break;
        
        case 'webp':
          pipeline = pipeline.webp({
            quality: this.webpQuality,
            effort: 6
          });
          break;
        
        case 'gif':
          pipeline = pipeline.gif();
          break;
        
        default:
          // Keep original format
          break;
      }

      await pipeline.toFile(outputPath);
      
      // Get info about optimized image
      const optimizedInfo = await this.getImageInfo(outputPath);
      return optimizedInfo;
    } catch (error) {
      logger.error('Error optimizing image:', error);
      throw new Error('Failed to optimize image');
    }
  }

  // Create responsive images
  async createResponsiveImages(inputPath, outputDir, baseName) {
    const sizes = [
      { name: 'thumbnail', width: 150, height: 150 },
      { name: 'small', width: 300 },
      { name: 'medium', width: 600 },
      { name: 'large', width: 1200 },
      { name: 'xlarge', width: 1920 }
    ];

    const results = {};
    const originalExt = path.extname(baseName);
    const nameWithoutExt = path.basename(baseName, originalExt);

    for (const size of sizes) {
      try {
        const outputFileName = `${nameWithoutExt}_${size.name}${originalExt}`;
        const outputPath = path.join(outputDir, outputFileName);

        const optimizedInfo = await this.optimizeImage(inputPath, outputPath, {
          width: size.width,
          height: size.height,
          quality: this.defaultQuality
        });

        results[size.name] = {
          path: outputPath,
          filename: outputFileName,
          ...optimizedInfo
        };
      } catch (error) {
        logger.error(`Error creating ${size.name} version:`, error);
      }
    }

    return results;
  }

  // Convert to WebP
  async convertToWebP(inputPath, outputPath, quality = this.webpQuality) {
    try {
      await sharp(inputPath)
        .webp({ quality, effort: 6 })
        .toFile(outputPath);

      return await this.getImageInfo(outputPath);
    } catch (error) {
      logger.error('Error converting to WebP:', error);
      throw new Error('Failed to convert image to WebP');
    }
  }

  // Create image thumbnail
  async createThumbnail(inputPath, outputPath, size = 150) {
    try {
      await sharp(inputPath)
        .resize(size, size, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: this.defaultQuality })
        .toFile(outputPath);

      return await this.getImageInfo(outputPath);
    } catch (error) {
      logger.error('Error creating thumbnail:', error);
      throw new Error('Failed to create thumbnail');
    }
  }

  // Watermark image
  async addWatermark(inputPath, outputPath, watermarkPath, options = {}) {
    try {
      const {
        position = 'southeast',
        opacity = 0.5,
        margin = 10
      } = options;

      // Prepare watermark
      const watermark = await sharp(watermarkPath)
        .png()
        .toBuffer();

      // Apply watermark
      await sharp(inputPath)
        .composite([{
          input: watermark,
          gravity: position,
          blend: 'over'
        }])
        .toFile(outputPath);

      return await this.getImageInfo(outputPath);
    } catch (error) {
      logger.error('Error adding watermark:', error);
      throw new Error('Failed to add watermark');
    }
  }

  // Batch optimize images
  async batchOptimize(inputDir, outputDir, options = {}) {
    try {
      const files = await fs.readdir(inputDir);
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
      });

      const results = {
        successful: [],
        failed: []
      };

      for (const file of imageFiles) {
        try {
          const inputPath = path.join(inputDir, file);
          const outputPath = path.join(outputDir, file);

          await this.optimizeImage(inputPath, outputPath, options);
          results.successful.push(file);
        } catch (error) {
          results.failed.push({ file, error: error.message });
        }
      }

      return results;
    } catch (error) {
      logger.error('Error in batch optimization:', error);
      throw new Error('Failed to batch optimize images');
    }
  }

  // Calculate compression ratio
  async calculateCompressionRatio(originalPath, optimizedPath) {
    try {
      const [originalStats, optimizedStats] = await Promise.all([
        fs.stat(originalPath),
        fs.stat(optimizedPath)
      ]);

      const originalSize = originalStats.size;
      const optimizedSize = optimizedStats.size;
      const ratio = ((originalSize - optimizedSize) / originalSize) * 100;

      return {
        originalSize,
        optimizedSize,
        savedBytes: originalSize - optimizedSize,
        compressionRatio: Math.round(ratio * 100) / 100
      };
    } catch (error) {
      logger.error('Error calculating compression ratio:', error);
      return null;
    }
  }

  // Extract dominant colors
  async extractDominantColors(imagePath, colorCount = 5) {
    try {
      const { dominant } = await sharp(imagePath)
        .stats();

      return {
        dominant: {
          r: Math.round(dominant.r),
          g: Math.round(dominant.g),
          b: Math.round(dominant.b)
        }
      };
    } catch (error) {
      logger.error('Error extracting dominant colors:', error);
      return null;
    }
  }

  // Validate image
  async validateImage(inputPath, options = {}) {
    try {
      const {
        maxWidth = 5000,
        maxHeight = 5000,
        maxSize = 10 * 1024 * 1024, // 10MB
        allowedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif']
      } = options;

      const info = await this.getImageInfo(inputPath);
      const stats = await fs.stat(inputPath);

      const validation = {
        valid: true,
        errors: []
      };

      if (info.width > maxWidth) {
        validation.valid = false;
        validation.errors.push(`Image width (${info.width}px) exceeds maximum allowed (${maxWidth}px)`);
      }

      if (info.height > maxHeight) {
        validation.valid = false;
        validation.errors.push(`Image height (${info.height}px) exceeds maximum allowed (${maxHeight}px)`);
      }

      if (stats.size > maxSize) {
        validation.valid = false;
        validation.errors.push(`Image size (${stats.size} bytes) exceeds maximum allowed (${maxSize} bytes)`);
      }

      if (!allowedFormats.includes(info.format)) {
        validation.valid = false;
        validation.errors.push(`Image format (${info.format}) is not allowed`);
      }

      return validation;
    } catch (error) {
      return {
        valid: false,
        errors: ['Failed to validate image: ' + error.message]
      };
    }
  }
}

module.exports = new ImageOptimizer();