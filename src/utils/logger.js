// src/utils/logger.js - Simple fallback logger
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Simple logger class
class SimpleLogger {
  constructor() {
    this.logFile = path.join(logsDir, 'app.log');
    this.errorFile = path.join(logsDir, 'error.log');
  }

  // Format log message
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  // Write to file
  writeToFile(filename, message) {
    try {
      fs.appendFileSync(filename, message + '\n');
    } catch (error) {
      // If file write fails, just continue
      console.error('Failed to write to log file:', error.message);
    }
  }

  // Log levels
  info(message, meta = {}) {
    const formatted = this.formatMessage('info', message, meta);
    console.log(`\x1b[32m${formatted}\x1b[0m`); // Green
    this.writeToFile(this.logFile, formatted);
  }

  warn(message, meta = {}) {
    const formatted = this.formatMessage('warn', message, meta);
    console.warn(`\x1b[33m${formatted}\x1b[0m`); // Yellow
    this.writeToFile(this.logFile, formatted);
  }

  error(message, meta = {}) {
    const formatted = this.formatMessage('error', message, meta);
    console.error(`\x1b[31m${formatted}\x1b[0m`); // Red
    this.writeToFile(this.logFile, formatted);
    this.writeToFile(this.errorFile, formatted);
  }

  debug(message, meta = {}) {
    if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'debug') {
      const formatted = this.formatMessage('debug', message, meta);
      console.log(`\x1b[36m${formatted}\x1b[0m`); // Cyan
      this.writeToFile(this.logFile, formatted);
    }
  }

  // Request logging middleware
  logRequest(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
      
      if (res.statusCode >= 400) {
        this.warn(message, {
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      } else {
        this.info(message);
      }
    });
    
    next();
  }

  // Security logging
  security = {
    loginAttempt: (email, ip, success, userAgent) => {
      this.info('Login attempt', {
        event: 'login_attempt',
        email,
        ip,
        success,
        userAgent,
        timestamp: new Date().toISOString()
      });
    },
    
    suspiciousActivity: (ip, activity, details) => {
      this.warn('Suspicious activity detected', {
        event: 'suspicious_activity',
        ip,
        activity,
        details,
        timestamp: new Date().toISOString()
      });
    },
    
    securityViolation: (ip, violation, details) => {
      this.error('Security violation', {
        event: 'security_violation',
        ip,
        violation,
        details,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Performance logging
  performance = {
    slow: (operation, duration, threshold = 1000) => {
      if (duration > threshold) {
        this.warn(`Slow operation detected: ${operation}`, {
          event: 'slow_operation',
          operation,
          duration,
          threshold,
          timestamp: new Date().toISOString()
        });
      }
    },
    
    database: (query, duration, threshold = 100) => {
      if (duration > threshold) {
        this.warn(`Slow database query`, {
          event: 'slow_query',
          query: query.substring(0, 200),
          duration,
          threshold,
          timestamp: new Date().toISOString()
        });
      }
    }
  };
}

// Try to use winston if available, fallback to simple logger
let logger;

try {
  // Try to load winston first
  const winston = require('winston');
  const winLogger = require('./logger-winston'); // Your full winston logger
  logger = winLogger;
} catch (error) {
  // Fallback to simple logger if winston fails
  logger = new SimpleLogger();
  logger.warn('Winston logger not available, using simple logger fallback');
}

module.exports = logger;