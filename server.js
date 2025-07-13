// server.js - Fixed version with proper middleware handling
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Initialize Express app
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Import configurations and utilities
let db, logger, errorHandler;

try {
  db = require('./src/config/database');
  logger = require('./scripts/baksrc/utils/logger');
  errorHandler = require('./src/middleware/errorHandler');
} catch (error) {
  console.error('❌ Failed to load core dependencies:', error.message);
  console.error('Please ensure all required files exist and dependencies are installed.');
  process.exit(1);
}

// Import route handlers with error handling
let authRoutes, articleRoutes, categoryRoutes, tagRoutes, commentRoutes, 
    mediaRoutes, userRoutes, adsRoutes, analyticsRoutes, searchRoutes, sitemapRoutes;

try {
  authRoutes = require('./src/routes/auth');
  articleRoutes = require('./src/routes/articles');
  categoryRoutes = require('./src/routes/categories');
  tagRoutes = require('./src/routes/tags');
  commentRoutes = require('./src/routes/comments');
  mediaRoutes = require('./src/routes/media');
  userRoutes = require('./src/routes/users');
  adsRoutes = require('./src/routes/ads');
  analyticsRoutes = require('./src/routes/analytics');
  searchRoutes = require('./src/routes/search');
  sitemapRoutes = require('./src/routes/sitemap');
  
  logger.info('✅ All route modules loaded successfully');
} catch (error) {
  logger.error('❌ Failed to load route modules:', error.message);
  logger.error('Some API endpoints may not be available');
  
  // Create fallback empty router to prevent crashes
  const emptyRouter = express.Router();
  emptyRouter.use('*', (req, res) => {
    res.status(503).json({
      success: false,
      error: 'Service temporarily unavailable'
    });
  });
  
  authRoutes = authRoutes || emptyRouter;
  articleRoutes = articleRoutes || emptyRouter;
  categoryRoutes = categoryRoutes || emptyRouter;
  tagRoutes = tagRoutes || emptyRouter;
  commentRoutes = commentRoutes || emptyRouter;
  mediaRoutes = mediaRoutes || emptyRouter;
  userRoutes = userRoutes || emptyRouter;
  adsRoutes = adsRoutes || emptyRouter;
  analyticsRoutes = analyticsRoutes || emptyRouter;
  searchRoutes = searchRoutes || emptyRouter;
  sitemapRoutes = sitemapRoutes || emptyRouter;
}

// Trust proxy (important for rate limiting and IP detection)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      scriptSrc: ["'self'", "https:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https:"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15') * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'), // limit each IP
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
});

app.use(limiter);

// CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3000",
      "http://localhost:3001", // Additional frontend dev server
      "http://127.0.0.1:3000"
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Security middleware
app.use(mongoSanitize());
app.use(hpp({
  whitelist: ['tags', 'categories'] // Allow arrays for these fields
}));

// Compression middleware
app.use(compression());

// Logging middleware
if (logger && logger.logRequest) {
  app.use(logger.logRequest);
} else {
  // Fallback simple logging
  app.use(morgan('combined'));
}

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// SEO routes (these need to be before the API routes to catch root-level requests)
app.use('/', sitemapRoutes);

// API routes with error handling
const apiPrefix = `/api/${process.env.API_VERSION || 'v1'}`;

// Root endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'News Portal API',
    version: process.env.npm_package_version || '1.0.0',
    documentation: `${req.protocol}://${req.get('host')}/api/docs`,
  });
});

// API Routes with proper error handling
try {
  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/articles`, articleRoutes);
  app.use(`${apiPrefix}/categories`, categoryRoutes);
  app.use(`${apiPrefix}/tags`, tagRoutes);
  app.use(`${apiPrefix}/comments`, commentRoutes);
  app.use(`${apiPrefix}/media`, mediaRoutes);
  app.use(`${apiPrefix}/users`, userRoutes);
  app.use(`${apiPrefix}/ads`, adsRoutes);
  app.use(`${apiPrefix}/analytics`, analyticsRoutes);
  app.use(`${apiPrefix}/search`, searchRoutes);
  
  logger.info('✅ All API routes registered successfully');
} catch (error) {
  logger.error('❌ Error registering API routes:', error.message);
}

// 404 handler for API routes
app.use(`${apiPrefix}/*`, (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// 404 handler for all other routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    available_endpoints: {
      api: apiPrefix,
      documentation: '/api/docs'
    }
  });
});

// Sitemap generation on startup
if (process.env.GENERATE_SITEMAPS_ON_START === 'true') {
  setTimeout(async () => {
    try {
      console.log('Generating initial sitemaps...');
      const sitemapService = require('./src/services/sitemapService');
      await sitemapService.generateAllSitemaps();
      console.log('✅ Sitemaps generated successfully');
    } catch (error) {
      console.error('❌ Sitemap generation failed:', error.message);
      // Don't crash the server
    }
  }, 10000); // Wait 10 seconds after server start
}

// Schedule sitemap generation (runs every hour)
if (process.env.ENABLE_SITEMAP_CRON === 'true') {
  const cron = require('node-cron');
  
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Running scheduled sitemap generation...');
      const sitemapService = require('./src/services/sitemapService');
      await sitemapService.generateAllSitemaps();
      
      // Ping search engines if enabled
      if (process.env.PING_SEARCH_ENGINES === 'true') {
        await sitemapService.pingSearchEngines();
      }
      
      logger.info('Scheduled sitemap generation completed');
    } catch (error) {
      logger.error('Scheduled sitemap generation failed:', error);
    }
  });
  
  logger.info('Sitemap cron job scheduled to run every hour');
}

// Clear sitemap cache when articles are published/updated
const clearSitemapCacheMiddleware = (req, res, next) => {
  // Store original res.json
  const originalJson = res.json;
  
  // Override res.json
  res.json = function(data) {
    // Clear sitemap cache if operation was successful
    if (data && data.success) {
      setTimeout(async () => {
        try {
          const sitemapService = require('./src/services/sitemapService');
          await sitemapService.clearSitemapCache();
          logger.info('Sitemap cache cleared after article update');
        } catch (error) {
          logger.error('Failed to clear sitemap cache:', error);
        }
      }, 1000);
    }
    
    // Call original res.json
    return originalJson.call(this, data);
  };
  
  next();
};

// Apply cache clearing middleware to article routes
app.use(`${apiPrefix}/articles`, clearSitemapCacheMiddleware);

// Global error handler
if (errorHandler && typeof errorHandler === 'function') {
  app.use(errorHandler);
} else {
  // Fallback error handler
  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    
    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(err.statusCode || 500).json({
      success: false,
      error: isDevelopment ? err.message : 'Internal server error',
      ...(isDevelopment && { stack: err.stack })
    });
  });
}

// Socket.IO for live features
io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.id}`);
  
  socket.on('join-article', (articleId) => {
    socket.join(`article-${articleId}`);
    logger.info(`User ${socket.id} joined article ${articleId}`);
  });
  
  socket.on('leave-article', (articleId) => {
    socket.leave(`article-${articleId}`);
    logger.info(`User ${socket.id} left article ${articleId}`);
  });
  
  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set('io', io);

// Database connection with retry logic
async function connectDatabase() {
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      if (db && db.getConnection) {
        await new Promise((resolve, reject) => {
          db.getConnection((err, connection) => {
            if (err) {
              reject(err);
            } else {
              logger.info('✅ Database connected successfully');
              connection.release();
              resolve();
            }
          });
        });
        break;
      } else {
        throw new Error('Database configuration not available');
      }
    } catch (error) {
      retries++;
      logger.error(`❌ Database connection attempt ${retries} failed:`, error.message);
      
      if (retries >= maxRetries) {
        logger.error('❌ Max database connection retries reached. Exiting...');
        process.exit(1);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 3000 * retries));
    }
  }
}

// Graceful shutdown handlers
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Close database connections
    if (db && db.pool && db.pool.end) {
      db.pool.end(() => {
        logger.info('Database connections closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled promise rejection handler
process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Promise Rejection:', err);
  // Close server & exit process
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Uncaught exception handler
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Start server
async function startServer() {
  try {
    // Connect to database first
    await connectDatabase();
    
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    
    server.listen(PORT, HOST, () => {
      logger.info(`🚀 Server running on http://${HOST}:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      logger.info(`📚 API available at http://${HOST}:${PORT}${apiPrefix}`);
      
      // Log available routes
      logger.info('📋 Available API endpoints:');
      logger.info(`   - Auth: ${apiPrefix}/auth`);
      logger.info(`   - Articles: ${apiPrefix}/articles`);
      logger.info(`   - Categories: ${apiPrefix}/categories`);
      logger.info(`   - Tags: ${apiPrefix}/tags`);
      logger.info(`   - Comments: ${apiPrefix}/comments`);
      logger.info(`   - Media: ${apiPrefix}/media`);
      logger.info(`   - Users: ${apiPrefix}/users`);
      logger.info(`   - Ads: ${apiPrefix}/ads`);
      logger.info(`   - Analytics: ${apiPrefix}/analytics`);
      logger.info(`   - Search: ${apiPrefix}/search`);
      logger.info('📋 Available SEO endpoints:');
      logger.info(`   - Sitemap Index: http://${HOST}:${PORT}/sitemap.xml`);
      logger.info(`   - Robots.txt: http://${HOST}:${PORT}/robots.txt`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = app;