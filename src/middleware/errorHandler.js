// src/middleware/errorHandler.js - Improved version to prevent crashes
const logger = require('../../scripts/baksrc/utils/logger');

// Custom error class
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Handle MySQL errors
const handleMySQLError = (err) => {
  let error;
  
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      const field = err.sqlMessage?.match(/for key '(.+?)'/)?.[1] || 'field';
      error = new AppError(`Duplicate value for ${field}`, 400, 'DUPLICATE_ENTRY');
      break;
    
    case 'ER_NO_REFERENCED_ROW_2':
      error = new AppError('Referenced record does not exist', 400, 'INVALID_REFERENCE');
      break;
    
    case 'ER_ROW_IS_REFERENCED_2':
      error = new AppError('Cannot delete record as it is referenced by other records', 400, 'REFERENCED_RECORD');
      break;
    
    case 'ER_BAD_FIELD_ERROR':
      error = new AppError('Invalid field in query', 400, 'INVALID_FIELD');
      break;
    
    case 'ER_TABLE_DOESNT_EXIST':
      error = new AppError('Database table does not exist', 500, 'TABLE_NOT_FOUND');
      break;
    
    case 'ER_ACCESS_DENIED_ERROR':
      error = new AppError('Database access denied', 500, 'DB_ACCESS_DENIED');
      break;
    
    case 'ECONNREFUSED':
      error = new AppError('Database connection refused', 500, 'DB_CONNECTION_REFUSED');
      break;
    
    case 'PROTOCOL_CONNECTION_LOST':
      error = new AppError('Database connection lost', 500, 'DB_CONNECTION_LOST');
      break;
    
    case 'ER_PARSE_ERROR':
      error = new AppError('Database query parse error', 500, 'DB_PARSE_ERROR');
      break;
    
    case 'ER_BAD_DB_ERROR':
      error = new AppError('Database does not exist', 500, 'DB_NOT_FOUND');
      break;
    
    default:
      error = new AppError('Database operation failed', 500, 'DB_ERROR');
  }
  
  return error;
};

// Handle JWT errors
const handleJWTError = (err) => {
  switch (err.name) {
    case 'JsonWebTokenError':
      return new AppError('Invalid authentication token', 401, 'INVALID_TOKEN');
    
    case 'TokenExpiredError':
      return new AppError('Authentication token has expired', 401, 'TOKEN_EXPIRED');
    
    case 'NotBeforeError':
      return new AppError('Authentication token not active yet', 401, 'TOKEN_NOT_ACTIVE');
    
    default:
      return new AppError('Authentication token error', 401, 'TOKEN_ERROR');
  }
};

// Handle validation errors
const handleValidationError = (err) => {
  if (err.details && Array.isArray(err.details)) {
    const errors = err.details.map(detail => detail.message);
    return new AppError(`Validation failed: ${errors.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  
  if (err.errors && Array.isArray(err.errors)) {
    const errors = err.errors.map(error => error.msg || error.message);
    return new AppError(`Validation failed: ${errors.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  
  return new AppError('Validation error occurred', 400, 'VALIDATION_ERROR');
};

// Handle file upload errors
const handleMulterError = (err) => {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new AppError('File size too large', 400, 'FILE_TOO_LARGE');
    
    case 'LIMIT_FILE_COUNT':
      return new AppError('Too many files uploaded', 400, 'TOO_MANY_FILES');
    
    case 'LIMIT_UNEXPECTED_FILE':
      return new AppError('Unexpected file field', 400, 'UNEXPECTED_FILE');
    
    case 'LIMIT_PART_COUNT':
      return new AppError('Too many form parts', 400, 'TOO_MANY_PARTS');
    
    case 'LIMIT_FIELD_KEY':
      return new AppError('Field name too long', 400, 'FIELD_NAME_TOO_LONG');
    
    case 'LIMIT_FIELD_VALUE':
      return new AppError('Field value too long', 400, 'FIELD_VALUE_TOO_LONG');
    
    case 'LIMIT_FIELD_COUNT':
      return new AppError('Too many form fields', 400, 'TOO_MANY_FIELDS');
    
    default:
      return new AppError('File upload error', 400, 'FILE_UPLOAD_ERROR');
  }
};

// Handle Redis errors
const handleRedisError = (err) => {
  if (err.code === 'ECONNREFUSED') {
    return new AppError('Cache service unavailable', 503, 'CACHE_UNAVAILABLE');
  }
  
  if (err.code === 'ENOTFOUND') {
    return new AppError('Cache service not found', 503, 'CACHE_NOT_FOUND');
  }
  
  return new AppError('Cache service error', 500, 'CACHE_ERROR');
};

// Handle email service errors
const handleEmailError = (err) => {
  if (err.code === 'EAUTH') {
    return new AppError('Email authentication failed', 500, 'EMAIL_AUTH_ERROR');
  }
  
  if (err.code === 'ECONNECTION') {
    return new AppError('Email service connection failed', 500, 'EMAIL_CONNECTION_ERROR');
  }
  
  if (err.code === 'EMESSAGE') {
    return new AppError('Invalid email message', 400, 'INVALID_EMAIL');
  }
  
  return new AppError('Email service error', 500, 'EMAIL_ERROR');
};

// Send error response for development
const sendErrorDev = (err, req, res) => {
  const response = {
    success: false,
    error: err.message,
    code: err.code || 'UNKNOWN_ERROR',
    statusCode: err.statusCode,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };

  // Include additional error details if available
  if (err.details) {
    response.details = err.details;
  }

  res.status(err.statusCode || 500).json(response);
};

// Send error response for production
const sendErrorProd = (err, req, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    const response = {
      success: false,
      error: err.message,
      code: err.code || 'OPERATIONAL_ERROR',
      timestamp: new Date().toISOString()
    };

    res.status(err.statusCode || 500).json(response);
  } else {
    // Programming or other unknown error: don't leak error details
    logger.error('CRITICAL ERROR - Non-operational error occurred:', {
      error: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'An internal server error occurred',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// Main error handling middleware
const errorHandler = (err, req, res, next) => {
  // Prevent multiple error responses
  if (res.headersSent) {
    return next(err);
  }

  // Set default error properties
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log all errors with context
  const errorContext = {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    timestamp: new Date().toISOString(),
    body: req.method !== 'GET' ? req.body : undefined,
    params: req.params,
    query: req.query
  };

  // Log based on error severity
  if (err.statusCode >= 500) {
    logger.error('Server Error:', errorContext);
  } else if (err.statusCode >= 400) {
    logger.warn('Client Error:', errorContext);
  } else {
    logger.info('Error handled:', errorContext);
  }

  let error = { ...err };
  error.message = err.message;

  // Handle specific error types
  try {
    // Database errors
    if (err.code?.startsWith('ER_') || 
        err.code === 'ECONNREFUSED' || 
        err.code === 'PROTOCOL_CONNECTION_LOST' ||
        err.errno) {
      error = handleMySQLError(err);
    }
    
    // JWT errors
    else if (err.name?.includes('JsonWebToken') || 
             err.name === 'TokenExpiredError' || 
             err.name === 'NotBeforeError') {
      error = handleJWTError(err);
    }
    
    // Validation errors
    else if (err.name === 'ValidationError' || 
             (err.details && Array.isArray(err.details)) ||
             (err.errors && Array.isArray(err.errors))) {
      error = handleValidationError(err);
    }
    
    // Multer file upload errors
    else if (err.name === 'MulterError') {
      error = handleMulterError(err);
    }
    
    // Redis errors
    else if (err.name === 'RedisError' || err.command) {
      error = handleRedisError(err);
    }
    
    // Email errors
    else if (err.name === 'EmailError' || err.responseCode) {
      error = handleEmailError(err);
    }
    
    // Cast specific status code errors
    else if (err.statusCode === 404 && !err.isOperational) {
      error = new AppError('Resource not found', 404, 'NOT_FOUND');
    }
    else if (err.statusCode === 403 && !err.isOperational) {
      error = new AppError('Access forbidden', 403, 'FORBIDDEN');
    }
    else if (err.statusCode === 401 && !err.isOperational) {
      error = new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

  } catch (handlerError) {
    // If error handling itself fails, log it and continue with original error
    logger.error('Error in error handler:', handlerError);
    error = new AppError('Internal server error', 500, 'HANDLER_ERROR');
  }

  // Send appropriate response based on environment
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, req, res);
  } else {
    sendErrorProd(error, req, res);
  }
};

// Async error wrapper with better error handling
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      // Ensure error is properly formatted
      if (!(error instanceof Error)) {
        error = new Error(String(error));
      }
      
      // Add additional context if available
      if (!error.statusCode) {
        error.statusCode = 500;
      }
      
      next(error);
    });
  };
};

// 404 handler
const notFound = (req, res, next) => {
  const error = new AppError(`Route not found - ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND');
  next(error);
};

// Global uncaught exception handler
const handleUncaughtException = (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...', {
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
  
  // Give time for logger to write
  setTimeout(() => {
    process.exit(1);
  }, 1000);
};

// Global unhandled promise rejection handler
const handleUnhandledRejection = (err, promise) => {
  logger.error('UNHANDLED PROMISE REJECTION! Shutting down...', {
    error: err?.message || String(err),
    stack: err?.stack,
    promise: promise,
    timestamp: new Date().toISOString()
  });
  
  // Close server gracefully if possible
  if (global.server) {
    global.server.close(() => {
      logger.info('Server closed due to unhandled rejection');
      process.exit(1);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Could not close server gracefully, forcing shutdown');
      process.exit(1);
    }, 10000);
  } else {
    // If no server reference, exit after a delay
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
};

// SIGTERM handler for graceful shutdown
const handleSIGTERM = () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  if (global.server) {
    global.server.close(() => {
      logger.info('Process terminated gracefully');
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Could not close server gracefully, forcing shutdown');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

// SIGINT handler (Ctrl+C)
const handleSIGINT = () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  if (global.server) {
    global.server.close(() => {
      logger.info('Process terminated gracefully');
      process.exit(0);
    });
    
    // Force close after 5 seconds for development
    setTimeout(() => {
      logger.error('Could not close server gracefully, forcing shutdown');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
};

// Setup global error handlers
const setupGlobalErrorHandlers = () => {
  // Handle uncaught exceptions
  process.on('uncaughtException', handleUncaughtException);
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', handleUnhandledRejection);
  
  // Handle graceful shutdown signals
  process.on('SIGTERM', handleSIGTERM);
  process.on('SIGINT', handleSIGINT);
  
  // Log that handlers are setup
  logger.info('Global error handlers setup complete');
};

// Health check for error handling system
const healthCheck = () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    errorHandlers: {
      uncaughtException: true,
      unhandledRejection: true,
      gracefulShutdown: true
    }
  };
};

// Error rate limiter to prevent error spam
class ErrorRateLimiter {
  constructor(maxErrors = 100, windowMs = 60000) { // 100 errors per minute
    this.maxErrors = maxErrors;
    this.windowMs = windowMs;
    this.errors = new Map();
  }

  shouldLimit(errorKey) {
    const now = Date.now();
    const errorCount = this.errors.get(errorKey) || [];
    
    // Remove old errors outside the window
    const recentErrors = errorCount.filter(timestamp => 
      now - timestamp < this.windowMs
    );
    
    if (recentErrors.length >= this.maxErrors) {
      return true; // Rate limit this error
    }
    
    // Add current error
    recentErrors.push(now);
    this.errors.set(errorKey, recentErrors);
    
    return false;
  }

  getErrorKey(err, req) {
    // Create a unique key for this type of error
    return `${err.message || 'unknown'}_${req.path || 'unknown'}_${err.statusCode || 500}`;
  }
}

const errorLimiter = new ErrorRateLimiter();

// Enhanced error handler with rate limiting
const rateLimitedErrorHandler = (err, req, res, next) => {
  const errorKey = errorLimiter.getErrorKey(err, req);
  
  // Check if this error type is being rate limited
  if (errorLimiter.shouldLimit(errorKey)) {
    // Log that we're rate limiting but don't spam logs
    if (Math.random() < 0.01) { // 1% chance to log rate limited errors
      logger.warn('Error rate limited:', {
        errorKey,
        url: req.originalUrl,
        ip: req.ip
      });
    }
    
    // Send a generic rate limited response
    return res.status(429).json({
      success: false,
      error: 'Too many similar errors. Please try again later.',
      code: 'ERROR_RATE_LIMITED',
      timestamp: new Date().toISOString()
    });
  }
  
  // Process error normally
  return errorHandler(err, req, res, next);
};

// Validation helper for common scenarios
const validateAndHandle = (validationFn, errorMessage = 'Validation failed') => {
  return (req, res, next) => {
    try {
      const isValid = validationFn(req);
      if (!isValid) {
        throw new AppError(errorMessage, 400, 'VALIDATION_FAILED');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Database connection error handler
const handleDatabaseError = async (error, retryCount = 0, maxRetries = 3) => {
  logger.error(`Database error (attempt ${retryCount + 1}):`, error);
  
  if (retryCount < maxRetries) {
    const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
    logger.info(`Retrying database operation in ${delay}ms...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return false; // Indicate retry is possible
  }
  
  return true; // Indicate max retries reached
};

// Circuit breaker for external services
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.failures = 0;
    this.lastFailTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async call(fn, ...args) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new AppError('Circuit breaker is OPEN', 503, 'CIRCUIT_BREAKER_OPEN');
      }
    }

    try {
      const result = await fn(...args);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures++;
    this.lastFailTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}

// Error reporting helper (for external services like Sentry)
const reportError = (error, context = {}) => {
  // Only report in production
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  try {
    // Here you would integrate with error reporting services
    // like Sentry, Bugsnag, etc.
    logger.error('Error reported to external service:', {
      error: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    });
  } catch (reportingError) {
    logger.error('Failed to report error to external service:', reportingError);
  }
};

module.exports = {
  AppError,
  errorHandler,
  rateLimitedErrorHandler,
  asyncHandler,
  notFound,
  handleMySQLError,
  handleJWTError,
  handleValidationError,
  handleMulterError,
  handleRedisError,
  handleEmailError,
  setupGlobalErrorHandlers,
  healthCheck,
  ErrorRateLimiter,
  validateAndHandle,
  handleDatabaseError,
  CircuitBreaker,
  reportError
};