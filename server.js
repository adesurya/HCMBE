// server.js - Improved version with better error handling and crash prevention
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

// Store server reference globally for graceful shutdown
global.server = server;

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Import configurations and utilities with error handling
let db, logger, errorHandler, setupGlobalErrorHandlers;

try {
  db = require('./src/config/database');
  logger = require('./scripts/baksrc/utils/logger');
  const errorHandlerModule = require('./src/middleware/errorHandler');
  errorHandler = errorHandlerModule.rateLimitedErrorHandler; // Use rate limited version
  setupGlobalErrorHandlers = errorHandlerModule.setupGlobalErrorHandlers;
  
  // Setup global error handlers early
  setupGlobalErrorHandlers();
  
} catch (error) {
  console.error('❌ Failed to load core dependencies:', error.message);
  console.error('Please ensure all required files exist and dependencies are installed.');
  process.exit(1);
}

// Import route handlers with comprehensive error handling
let authRoutes, articleRoutes, categoryRoutes, tagRoutes, commentRoutes, 
    mediaRoutes, userRoutes, adsRoutes, analyticsRoutes, searchRoutes, sitemapRoutes;

const loadRoutes = () => {
  const routes = {
    authRoutes: './src/routes/auth',
    articleRoutes: './src/routes/articles',
    categoryRoutes: './src/routes/categories',
    tagRoutes: './src/routes/tags',
    commentRoutes: './src/routes/comments',
    mediaRoutes: './src/routes/media',
    userRoutes: './src/routes/users',
    adsRoutes: './src/routes/ads',
    analyticsRoutes: './src/routes/analytics',
    searchRoutes: './src/routes/search',
    sitemapRoutes: './src/routes/sitemap'
  };

  const loadedRoutes = {};
  const failedRoutes = [];

  Object.entries(routes).forEach(([routeName, routePath]) => {
    try {
      loadedRoutes[routeName] = require(routePath);
      logger.info(`✅ Loaded route: ${routeName}`);
    } catch (error) {
      logger.error(`❌ Failed to load route ${routeName}:`, error.message);
      failedRoutes.push(routeName);
      
      // Create fallback empty router to prevent crashes
      const emptyRouter = express.Router();
      emptyRouter.use('*', (req, res) => {
        res.status(503).json({
          success: false,
          error: 'Service temporarily unavailable',
          code: 'ROUTE_UNAVAILABLE'
        });
      });
      loadedRoutes[routeName] = emptyRouter;
    }
  });

  // Assign loaded routes
  authRoutes = loadedRoutes.authRoutes;
  articleRoutes = loadedRoutes.articleRoutes;
  categoryRoutes = loadedRoutes.categoryRoutes;
  tagRoutes = loadedRoutes.tagRoutes;
  commentRoutes = loadedRoutes.commentRoutes;
  mediaRoutes = loadedRoutes.mediaRoutes;
  userRoutes = loadedRoutes.userRoutes;
  adsRoutes = loadedRoutes.adsRoutes;
  analyticsRoutes = loadedRoutes.analyticsRoutes;
  searchRoutes = loadedRoutes.searchRoutes;
  sitemapRoutes = loadedRoutes.sitemapRoutes;

  if (failedRoutes.length > 0) {
    logger.warn(`Some routes failed to load: ${failedRoutes.join(', ')}`);
    logger.warn('These routes will return 503 Service Unavailable');
  } else {
    logger.info('✅ All route modules loaded successfully');
  }

  return { loadedCount: Object.keys(loadedRoutes).length, failedCount: failedRoutes.length };
};

// Load routes
const routeStats = loadRoutes();

// Trust proxy (important for rate limiting and IP detection)
app.set('trust proxy', 1);

// Security middleware with error handling
try {
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
} catch (error) {
  logger.error('❌ Failed to setup Helmet security middleware:', error.message);
}

// Rate limiting with error handling
try {
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15') * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'), // limit each IP
    message: {
      success: false,
      error: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.ip || req.connection.remoteAddress || 'unknown';
    },
    handler: (req, res) => {
      logger.warn('Rate limit exceeded:', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path
      });
      
      res.status(429).json({
        success: false,
        error: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMITED',
        retryAfter: Math.round(parseInt(process.env.RATE_LIMIT_WINDOW || '15') * 60)
      });
    }
  });

  app.use(limiter);
} catch (error) {
  logger.error('❌ Failed to setup rate limiting:', error.message);
}

// CORS configuration with error handling
try {
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
        logger.warn('CORS blocked request from:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
} catch (error) {
  logger.error('❌ Failed to setup CORS:', error.message);
}

// Body parsing middleware with error handling
try {
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
} catch (error) {
  logger.error('❌ Failed to setup body parsing middleware:', error.message);
}

// Security middleware with error handling
try {
  app.use(mongoSanitize());
  app.use(hpp({
    whitelist: ['tags', 'categories'] // Allow arrays for these fields
  }));
} catch (error) {
  logger.error('❌ Failed to setup additional security middleware:', error.message);
}

// Compression middleware
try {
  app.use(compression());
} catch (error) {
  logger.error('❌ Failed to setup compression middleware:', error.message);
}

// Logging middleware with error handling
try {
  if (logger && logger.logRequest) {
    app.use(logger.logRequest);
  } else {
    // Fallback simple logging
    app.use(morgan('combined'));
  }
} catch (error) {
  logger.error('❌ Failed to setup logging middleware:', error.message);
  // Use basic console logging as fallback
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });
}

// Static files with error handling
try {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
  app.use('/public', express.static(path.join(__dirname, 'public')));
} catch (error) {
  logger.error('❌ Failed to setup static file serving:', error.message);
}

// Health check endpoint (should be before other routes)
app.get('/health', (req, res) => {
  try {
    const { healthCheck } = require('./src/middleware/errorHandler');
    const health = healthCheck();
    
    res.json({
      success: true,
      status: 'healthy',
      data: {
        ...health,
        routes: {
          loaded: routeStats.loadedCount,
          failed: routeStats.failedCount
        },
        database: db ? 'connected' : 'disconnected'
      }
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: 'Health check failed'
    });
  }
});

// SEO routes (these need to be before the API routes to catch root-level requests)
try {
  app.use('/', sitemapRoutes);
} catch (error) {
  logger.error('❌ Failed to setup sitemap routes:', error.message);
}

// API routes with error handling
const apiPrefix = `/api/${process.env.API_VERSION || 'v1'}`;

// Root endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'News Portal API',
    version: process.env.npm_package_version || '1.0.0',
    documentation: `${req.protocol}://${req.get('host')}/api/docs`,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// API Routes with proper error handling
const setupAPIRoutes = () => {
  const routes = [
    { path: '/auth', handler: authRoutes, name: 'Authentication' },
    { path: '/articles', handler: articleRoutes, name: 'Articles' },
    { path: '/categories', handler: categoryRoutes, name: 'Categories' },
    { path: '/tags', handler: tagRoutes, name: 'Tags' },
    { path: '/comments', handler: commentRoutes, name: 'Comments' },
    { path: '/media', handler: mediaRoutes, name: 'Media' },
    { path: '/users', handler: userRoutes, name: 'Users' },
    { path: '/ads', handler: adsRoutes, name: 'Advertisements' },
    { path: '/analytics', handler: analyticsRoutes, name: 'Analytics' },
    { path: '/search', handler: searchRoutes, name: 'Search' }
  ];

  let successCount = 0;
  let failureCount = 0;

  routes.forEach(({ path, handler, name }) => {
    try {
      app.use(`${apiPrefix}${path}`, handler);
      logger.info(`✅ Registered API route: ${apiPrefix}${path} (${name})`);
      successCount++;
    } catch (error) {
      logger.error(`❌ Failed to register API route ${path}:`, error.message);
      failureCount++;
      
      // Create fallback route
      app.use(`${apiPrefix}${path}`, (req, res) => {
        res.status(503).json({
          success: false,
          error: `${name} service temporarily unavailable`,
          code: 'SERVICE_UNAVAILABLE'
        });
      });
    }
  });

  logger.info(`📋 API Routes Summary: ${successCount} successful, ${failureCount} failed`);
};

setupAPIRoutes();

// 404 handler for API routes
app.use(`${apiPrefix}/*`, (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    code: 'ENDPOINT_NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: {
      auth: `${apiPrefix}/auth`,
      articles: `${apiPrefix}/articles`,
      categories: `${apiPrefix}/categories`,
      tags: `${apiPrefix}/tags`,
      comments: `${apiPrefix}/comments`,
      media: `${apiPrefix}/media`,
      users: `${apiPrefix}/users`,
      ads: `${apiPrefix}/ads`,
      analytics: `${apiPrefix}/analytics`,
      search: `${apiPrefix}/search`
    }
  });
});

// 404 handler for all other routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: {
      api: apiPrefix,
      health: '/health',
      documentation: '/api/docs'
    }
  });
});

// Sitemap generation on startup (with error handling)
if (process.env.GENERATE_SITEMAPS_ON_START === 'true') {
  setTimeout(async () => {
    try {
      logger.info('Generating initial sitemaps...');
      const sitemapService = require('./src/services/sitemapService');
      await sitemapService.generateAllSitemaps();
      logger.info('✅ Sitemaps generated successfully');
    } catch (error) {
      logger.error('❌ Sitemap generation failed:', error.message);
      // Don't crash the server
    }
  }, 10000); // Wait 10 seconds after server start
}

// Schedule sitemap generation (runs every hour) with error handling
if (process.env.ENABLE_SITEMAP_CRON === 'true') {
  try {
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
  } catch (error) {
    logger.error('❌ Failed to setup sitemap cron job:', error.message);
  }
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
try {
  app.use(`${apiPrefix}/articles`, clearSitemapCacheMiddleware);
} catch (error) {
  logger.error('❌ Failed to setup sitemap cache clearing middleware:', error.message);
}

// Socket.IO for live features with error handling
io.on('connection', (socket) => {
  try {
    logger.info(`User connected: ${socket.id}`);
    
    socket.on('join-article', (articleId) => {
      try {
        socket.join(`article-${articleId}`);
        logger.info(`User ${socket.id} joined article ${articleId}`);
      } catch (error) {
        logger.error('Error joining article room:', error);
      }
    });
    
    socket.on('leave-article', (articleId) => {
      try {
        socket.leave(`article-${articleId}`);
        logger.info(`User ${socket.id} left article ${articleId}`);
      } catch (error) {
        logger.error('Error leaving article room:', error);
      }
    });
    
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${socket.id}`);
    });
    
    socket.on('error', (error) => {
      logger.error('Socket.IO error:', error);
    });
    
  } catch (error) {
    logger.error('Socket.IO connection error:', error);
  }
});

// Make io available to routes
app.set('io', io);

// Database connection with retry logic and better error handling
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
        logger.error('❌ Max database connection retries reached.');
        logger.error('⚠️  Server will start but database features will be unavailable');
        logger.error('💡 Check your database configuration and restart the server');
        break; // Don't exit, just continue without database
      }
      
      // Wait before retry with exponential backoff
      const delay = Math.min(30000, 3000 * Math.pow(2, retries - 1));
      logger.info(`⏳ Retrying database connection in ${delay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Graceful shutdown handlers with better error handling
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, initiating graceful shutdown...`);
  
  // Close HTTP server
  server.close((err) => {
    if (err) {
      logger.error('Error closing HTTP server:', err);
    } else {
      logger.info('✅ HTTP server closed');
    }
    
    // Close database connections
    if (db && db.pool && db.pool.end) {
      db.pool.end((err) => {
        if (err) {
          logger.error('Error closing database connections:', err);
        } else {
          logger.info('✅ Database connections closed');
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
  
  // Force close after 30 seconds (increased from 10)
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Global error handler (this should be the last middleware)
app.use(errorHandler);

// Start server with comprehensive error handling
async function startServer() {
  try {
    // Connect to database first (but don't fail if it doesn't work)
    await connectDatabase();
    
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    
    server.listen(PORT, HOST, () => {
      logger.info(`🚀 Server running on http://${HOST}:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      logger.info(`📚 API available at http://${HOST}:${PORT}${apiPrefix}`);
      logger.info(`🏥 Health check at http://${HOST}:${PORT}/health`);
      
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
      
      // Log system status
      logger.info('📊 System Status:');
      logger.info(`   - Routes loaded: ${routeStats.loadedCount}/${routeStats.loadedCount + routeStats.failedCount}`);
      logger.info(`   - Database: ${db ? 'Connected' : 'Disconnected'}`);
      logger.info(`   - Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   - Node.js: ${process.version}`);
      logger.info(`   - Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
      
      // Show warnings if any services failed
      if (routeStats.failedCount > 0) {
        logger.warn(`⚠️  ${routeStats.failedCount} route(s) failed to load - check logs above`);
      }
      
      if (!db) {
        logger.warn('⚠️  Database not connected - some features may be unavailable');
      }
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use. Please choose a different port or stop the other process.`);
        process.exit(1);
      } else if (error.code === 'EACCES') {
        logger.error(`❌ Permission denied to bind to port ${PORT}. Try using a port number above 1024.`);
        process.exit(1);
      } else {
        logger.error('❌ Server error:', error.message);
        throw error;
      }
    });

    // Handle uncaught exceptions in server context
    server.on('clientError', (err, socket) => {
      logger.error('Client error:', err);
      if (!socket.destroyed) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      }
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error.message);
    logger.error('💡 Check your configuration and try again');
    
    // Don't exit immediately, give time for logger to write
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
}

// Error monitoring and recovery
const setupErrorMonitoring = () => {
  let errorCount = 0;
  const startTime = Date.now();

  // Monitor error rate
  setInterval(() => {
    const uptime = (Date.now() - startTime) / 1000 / 60; // minutes
    const errorRate = errorCount / uptime;

    if (errorRate > 10) { // More than 10 errors per minute
      logger.warn(`High error rate detected: ${errorRate.toFixed(2)} errors/minute`);
    }

    // Reset counter every hour
    if (uptime % 60 === 0) {
      errorCount = 0;
    }
  }, 60000); // Check every minute

  // Monitor memory usage
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

    if (heapUsedMB > 512) { // More than 512MB
      logger.warn(`High memory usage: ${heapUsedMB}MB/${heapTotalMB}MB`);
    }

    // Force garbage collection if memory usage is too high
    if (heapUsedMB > 1024 && global.gc) {
      logger.info('Forcing garbage collection due to high memory usage');
      global.gc();
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
};

// Setup monitoring
setupErrorMonitoring();

// Start the server
startServer().catch(error => {
  logger.error('❌ Critical startup error:', error);
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

module.exports = app;