// src/middleware/errorHandler.js
const logger = require('../utils/logger');

// Custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Handle MySQL errors
const handleMySQLError = (err) => {
  let error;
  
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      const field = err.sqlMessage.match(/for key '(.+?)'/)?.[1] || 'field';
      error = new AppError(`Duplicate value for ${field}`, 400);
      break;
    
    case 'ER_NO_REFERENCED_ROW_2':
      error = new AppError('Referenced record does not exist', 400);
      break;
    
    case 'ER_ROW_IS_REFERENCED_2':
      error = new AppError('Cannot delete record as it is referenced by other records', 400);
      break;
    
    case 'ER_BAD_FIELD_ERROR':
      error = new AppError('Invalid field in query', 400);
      break;
    
    case 'ER_TABLE_DOESNT_EXIST':
      error = new AppError('Table does not exist', 500);
      break;
    
    case 'ER_ACCESS_DENIED_ERROR':
      error = new AppError('Database access denied', 500);
      break;
    
    case 'ECONNREFUSED':
      error = new AppError('Database connection refused', 500);
      break;
    
    case 'PROTOCOL_CONNECTION_LOST':
      error = new AppError('Database connection lost', 500);
      break;
    
    default:
      error = new AppError('Database error occurred', 500);
  }
  
  return error;
};

// Handle JWT errors
const handleJWTError = (err) => {
  switch (err.name) {
    case 'JsonWebTokenError':
      return new AppError('Invalid token', 401);
    
    case 'TokenExpiredError':
      return new AppError('Token has expired', 401);
    
    case 'NotBeforeError':
      return new AppError('Token not active yet', 401);
    
    default:
      return new AppError('Token error', 401);
  }
};

// Handle validation errors
const handleValidationError = (err) => {
  const errors = err.details?.map(detail => detail.message) || ['Validation error'];
  return new AppError(`Validation failed: ${errors.join(', ')}`, 400);
};

// Handle file upload errors
const handleMulterError = (err) => {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new AppError('File size too large', 400);
    
    case 'LIMIT_FILE_COUNT':
      return new AppError('Too many files', 400);
    
    case 'LIMIT_UNEXPECTED_FILE':
      return new AppError('Unexpected file field', 400);
    
    case 'LIMIT_PART_COUNT':
      return new AppError('Too many parts', 400);
    
    case 'LIMIT_FIELD_KEY':
      return new AppError('Field name too long', 400);
    
    case 'LIMIT_FIELD_VALUE':
      return new AppError('Field value too long', 400);
    
    case 'LIMIT_FIELD_COUNT':
      return new AppError('Too many fields', 400);
    
    default:
      return new AppError('File upload error', 400);
  }
};

// Send error response for development
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success: false,
    error: err.message,
    stack: err.stack,
    details: err
  });
};

// Send error response for production
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message
    });
  } else {
    // Programming or other unknown error: don't leak error details
    logger.error('ERROR:', err);
    
    res.status(500).json({
      success: false,
      error: 'Something went wrong'
    });
  }
};

// Main error handling middleware
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });

  let error = { ...err };
  error.message = err.message;

  // Handle specific error types
  if (err.code?.startsWith('ER_') || err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
    error = handleMySQLError(err);
  }
  
  if (err.name?.includes('JsonWebToken') || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
    error = handleJWTError(err);
  }
  
  if (err.name === 'ValidationError') {
    error = handleValidationError(err);
  }
  
  if (err.name === 'MulterError') {
    error = handleMulterError(err);
  }

  // Handle specific status codes
  if (err.statusCode === 404) {
    error = new AppError('Resource not found', 404);
  }

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, res);
  } else {
    sendErrorProd(error, res);
  }
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler
const notFound = (req, res, next) => {
  const error = new AppError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

// Unhandled promise rejection handler
process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Promise Rejection:', err);
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});

// Uncaught exception handler
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = {
  AppError,
  errorHandler,
  asyncHandler,
  notFound,
  handleMySQLError,
  handleJWTError,
  handleValidationError,
  handleMulterError
};