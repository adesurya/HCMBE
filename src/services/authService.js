// src/services/authService.js - Enhanced with better error handling
const User = require('../models/User');
const redis = require('../config/redis');
const crypto = require('crypto');
const logger = require('../../scripts/baksrc/utils/logger');

class AuthService {
  constructor() {
    this.loginAttempts = new Map(); // In-memory store for demo, use Redis in production
    this.maxLoginAttempts = 5;
    this.lockoutDuration = 15 * 60; // 15 minutes
    this.otpLength = 6;
    this.otpValidityDuration = 600; // 10 minutes
  }

  // Generate OTP
  generateOTP(length = this.otpLength) {
    const digits = '0123456789';
    let otp = '';
    
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }
    
    return otp;
  }

  // Check if account is locked
  async isAccountLocked(identifier) {
    try {
      const key = `lockout:${identifier}`;
      const lockout = await redis.get(key);
      return lockout !== null;
    } catch (error) {
      logger.error('Error checking account lock status:', error);
      return false; // Fail open for availability
    }
  }

  // Lock account temporarily
  async lockAccount(identifier) {
    try {
      const key = `lockout:${identifier}`;
      await redis.set(key, '1', this.lockoutDuration);
      
      logger.warn(`Account locked for ${identifier}`, {
        duration: this.lockoutDuration,
        timestamp: new Date().toISOString()
      });
      return true;
    } catch (error) {
      logger.error('Error locking account:', error);
      return false;
    }
  }

  // Track failed login attempt
  async trackFailedLogin(identifier, ip) {
    try {
      const key = `failed_attempts:${identifier}`;
      const attempts = await redis.incr(key, 3600); // Expire after 1 hour

      logger.warn(`Failed login attempt for ${identifier}`, {
        attempt: attempts,
        ip,
        timestamp: new Date().toISOString()
      });

      if (attempts >= this.maxLoginAttempts) {
        await this.lockAccount(identifier);
        return true; // Account is now locked
      }

      return false;
    } catch (error) {
      logger.error('Error tracking failed login:', error);
      return false; // Don't block user if tracking fails
    }
  }

  // Clear failed login attempts
  async clearFailedAttempts(identifier) {
    try {
      const key = `failed_attempts:${identifier}`;
      await redis.del(key);
      return true;
    } catch (error) {
      logger.error('Error clearing failed attempts:', error);
      return false;
    }
  }

  // Validate login attempt (Step 1 - Username/Password only)
  async validateLoginAttempt(email, password, ip) {
    try {
      // Check if account is locked
      const isLocked = await this.isAccountLocked(email);
      if (isLocked) {
        const error = new Error('Account is temporarily locked due to too many failed login attempts');
        error.code = 'ACCOUNT_LOCKED';
        throw error;
      }

      // Find user with proper error handling
      let user;
      try {
        user = await User.findByEmail(email);
      } catch (dbError) {
        logger.error('Database error during user lookup:', dbError);
        const error = new Error('A system error occurred. Please try again later.');
        error.code = 'SYSTEM_ERROR';
        throw error;
      }

      if (!user) {
        // Track failed attempt even for non-existent users
        await this.trackFailedLogin(email, ip);
        const error = new Error('Invalid email or password');
        error.code = 'INVALID_CREDENTIALS';
        throw error;
      }

      // Check if account is active
      if (!user.is_active) {
        const error = new Error('Account is deactivated');
        error.code = 'ACCOUNT_DEACTIVATED';
        throw error;
      }

      // Check if email is verified
      if (!user.email_verified) {
        const error = new Error('Please verify your email address before logging in');
        error.code = 'EMAIL_NOT_VERIFIED';
        throw error;
      }

      // Verify password with proper error handling
      let isValidPassword;
      try {
        isValidPassword = await user.verifyPassword(password);
      } catch (verifyError) {
        logger.error('Error verifying password:', verifyError);
        const error = new Error('Authentication error. Please try again.');
        error.code = 'AUTH_ERROR';
        throw error;
      }

      if (!isValidPassword) {
        const isLocked = await this.trackFailedLogin(email, ip);
        if (isLocked) {
          const error = new Error('Too many failed attempts. Account is temporarily locked.');
          error.code = 'ACCOUNT_LOCKED_NOW';
          throw error;
        }
        const error = new Error('Invalid email or password');
        error.code = 'INVALID_CREDENTIALS';
        throw error;
      }

      // Clear failed attempts on successful password verification
      await this.clearFailedAttempts(email);

      return user;
    } catch (error) {
      // Re-throw known errors
      if (error.code) {
        throw error;
      }
      
      // Handle unknown errors
      logger.error('Unexpected error in validateLoginAttempt:', error);
      const unknownError = new Error('An unexpected error occurred. Please try again.');
      unknownError.code = 'UNKNOWN_ERROR';
      throw unknownError;
    }
  }

  // Store OTP session data
  async storeOTPSession(userId, email, otp, sessionToken) {
    try {
      const sessionData = {
        userId,
        email,
        otp,
        attempts: 0,
        maxAttempts: 3,
        resendCount: 0,
        maxResends: 3,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.otpValidityDuration * 1000).toISOString()
      };

      await redis.set(`otp:${sessionToken}`, JSON.stringify(sessionData), this.otpValidityDuration);
      return sessionData;
    } catch (error) {
      logger.error('Error storing OTP session:', error);
      const storeError = new Error('Failed to store verification session');
      storeError.code = 'OTP_STORE_ERROR';
      throw storeError;
    }
  }

  // Validate OTP
  async validateOTP(sessionToken, inputOTP) {
    try {
      const sessionDataString = await redis.get(`otp:${sessionToken}`);
      if (!sessionDataString) {
        const error = new Error('Invalid or expired verification session');
        error.code = 'INVALID_OTP_SESSION';
        throw error;
      }

      const sessionData = JSON.parse(sessionDataString);

      // Check if max attempts exceeded
      if (sessionData.attempts >= sessionData.maxAttempts) {
        await redis.del(`otp:${sessionToken}`);
        const error = new Error('Maximum verification attempts exceeded. Please request a new code.');
        error.code = 'MAX_OTP_ATTEMPTS';
        throw error;
      }

      // Check if OTP matches
      if (sessionData.otp !== inputOTP.toString()) {
        sessionData.attempts += 1;
        await redis.set(`otp:${sessionToken}`, JSON.stringify(sessionData), this.otpValidityDuration);
        
        const remainingAttempts = sessionData.maxAttempts - sessionData.attempts;
        const error = new Error(`Invalid verification code. ${remainingAttempts} attempts remaining.`);
        error.code = 'INVALID_OTP';
        error.remainingAttempts = remainingAttempts;
        throw error;
      }

      // OTP is valid
      await redis.del(`otp:${sessionToken}`);
      return sessionData;
    } catch (error) {
      // Re-throw known errors
      if (error.code) {
        throw error;
      }
      
      // Handle unknown errors
      logger.error('Unexpected error in validateOTP:', error);
      const unknownError = new Error('OTP validation failed. Please try again.');
      unknownError.code = 'OTP_VALIDATION_ERROR';
      throw unknownError;
    }
  }

  // Resend OTP
  async resendOTP(sessionToken) {
    try {
      const sessionDataString = await redis.get(`otp:${sessionToken}`);
      if (!sessionDataString) {
        const error = new Error('Invalid or expired verification session');
        error.code = 'INVALID_OTP_SESSION';
        throw error;
      }

      const sessionData = JSON.parse(sessionDataString);

      // Check if max resends exceeded
      if (sessionData.resendCount >= sessionData.maxResends) {
        const error = new Error('Maximum resend attempts exceeded. Please start the login process again.');
        error.code = 'MAX_RESENDS';
        throw error;
      }

      // Generate new OTP
      const newOTP = this.generateOTP();
      
      // Update session data
      sessionData.otp = newOTP;
      sessionData.attempts = 0;
      sessionData.resendCount += 1;
      sessionData.lastResentAt = new Date().toISOString();

      await redis.set(`otp:${sessionToken}`, JSON.stringify(sessionData), this.otpValidityDuration);

      return { newOTP, sessionData };
    } catch (error) {
      // Re-throw known errors
      if (error.code) {
        throw error;
      }
      
      // Handle unknown errors
      logger.error('Unexpected error in resendOTP:', error);
      const unknownError = new Error('Failed to resend OTP. Please try again.');
      unknownError.code = 'RESEND_ERROR';
      throw unknownError;
    }
  }

  // Generate secure tokens
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  // Validate password strength
  validatePasswordStrength(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const issues = [];

    if (password.length < minLength) {
      issues.push(`Password must be at least ${minLength} characters long`);
    }

    if (!hasUpperCase) {
      issues.push('Password must contain at least one uppercase letter');
    }

    if (!hasLowerCase) {
      issues.push('Password must contain at least one lowercase letter');
    }

    if (!hasNumbers) {
      issues.push('Password must contain at least one number');
    }

    if (!hasSpecialChar) {
      issues.push('Password must contain at least one special character');
    }

    return {
      isValid: issues.length === 0,
      issues,
      strength: this.calculatePasswordStrength(password)
    };
  }

  // Calculate password strength score
  calculatePasswordStrength(password) {
    let score = 0;

    // Length
    if (password.length >= 8) score += 2;
    if (password.length >= 12) score += 2;
    if (password.length >= 16) score += 2;

    // Character types
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 2;

    // Patterns
    if (!/(.)\1{2,}/.test(password)) score += 1; // No repeated characters
    if (!/123|abc|qwe/i.test(password)) score += 1; // No common sequences

    const strength = Math.min(10, score);

    if (strength < 4) return 'very_weak';
    if (strength < 6) return 'weak';
    if (strength < 8) return 'medium';
    if (strength < 10) return 'strong';
    return 'very_strong';
  }

  // Get user permissions based on role
  getUserPermissions(role) {
    const permissions = {
      admin: {
        articles: ['create', 'read', 'update', 'delete', 'approve', 'schedule'],
        users: ['create', 'read', 'update', 'delete', 'manage_roles'],
        categories: ['create', 'read', 'update', 'delete'],
        tags: ['create', 'read', 'update', 'delete'],
        comments: ['read', 'approve', 'delete'],
        media: ['upload', 'read', 'delete'],
        ads: ['create', 'read', 'update', 'delete'],
        analytics: ['read', 'export']
      },
      editor: {
        articles: ['create', 'read', 'update', 'delete', 'approve', 'schedule'],
        users: ['read'],
        categories: ['create', 'read', 'update'],
        tags: ['create', 'read', 'update'],
        comments: ['read', 'approve', 'delete'],
        media: ['upload', 'read', 'delete'],
        ads: ['read'],
        analytics: ['read']
      },
      journalist: {
        articles: ['create', 'read', 'update_own'],
        users: ['read_profile'],
        categories: ['read'],
        tags: ['read'],
        comments: ['read'],
        media: ['upload', 'read_own'],
        ads: ['read'],
        analytics: ['read_own']
      },
      user: {
        articles: ['read'],
        users: ['read_profile'],
        categories: ['read'],
        tags: ['read'],
        comments: ['create', 'read'],
        media: ['read'],
        ads: ['read'],
        analytics: []
      }
    };

    return permissions[role] || permissions.user;
  }

  // Session management
  async createSession(userId, deviceInfo = {}) {
    try {
      const sessionId = this.generateSecureToken();
      const sessionData = {
        userId,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        deviceInfo: {
          userAgent: deviceInfo.userAgent || 'unknown',
          ip: deviceInfo.ip || 'unknown',
          location: deviceInfo.location || 'unknown'
        }
      };

      await redis.setSession(sessionId, sessionData, 24 * 60 * 60); // 24 hours
      return sessionId;
    } catch (error) {
      logger.error('Error creating session:', error);
      return null;
    }
  }

  // Validate session
  async validateSession(sessionId) {
    try {
      const sessionData = await redis.getSession(sessionId);
      if (!sessionData) {
        return null;
      }

      // Update last activity
      sessionData.lastActivity = new Date().toISOString();
      await redis.setSession(sessionId, sessionData, 24 * 60 * 60);

      return sessionData;
    } catch (error) {
      logger.error('Error validating session:', error);
      return null;
    }
  }

  // Revoke session
  async revokeSession(sessionId) {
    try {
      await redis.deleteSession(sessionId);
      return true;
    } catch (error) {
      logger.error('Error revoking session:', error);
      return false;
    }
  }

  // Get user sessions
  async getUserSessions(userId) {
    try {
      // This is a simplified implementation
      // In a real app, you'd maintain a user-to-sessions mapping
      const sessions = [];
      // Implementation would depend on your session storage strategy
      return sessions;
    } catch (error) {
      logger.error('Error getting user sessions:', error);
      return [];
    }
  }

  // Check for suspicious activity
  detectSuspiciousActivity(user, currentRequest) {
    try {
      const suspiciousIndicators = [];

      // Check for unusual login location
      // (You'd need to implement geolocation for this)

      // Check for unusual login time
      const currentHour = new Date().getHours();
      if (currentHour < 6 || currentHour > 23) {
        suspiciousIndicators.push('unusual_time');
      }

      // Check for multiple rapid login attempts
      // (This would require tracking recent login patterns)

      return {
        isSuspicious: suspiciousIndicators.length > 0,
        indicators: suspiciousIndicators,
        riskLevel: suspiciousIndicators.length > 2 ? 'high' : 
                   suspiciousIndicators.length > 0 ? 'medium' : 'low'
      };
    } catch (error) {
      logger.error('Error detecting suspicious activity:', error);
      return {
        isSuspicious: false,
        indicators: [],
        riskLevel: 'low'
      };
    }
  }

  // Password reset flow
  async initiatePasswordReset(email) {
    try {
      const user = await User.findByEmail(email);
      if (!user) {
        // Don't reveal if email exists or not
        return { success: true };
      }

      const resetToken = await user.generateResetToken();
      
      // Store additional reset data
      await redis.set(`reset_meta:${resetToken}`, {
        userId: user.id,
        email: user.email,
        requestTime: new Date().toISOString()
      }, 10 * 60); // 10 minutes

      return { success: true, token: resetToken };
    } catch (error) {
      logger.error('Error initiating password reset:', error);
      return { success: false, error: 'Password reset failed' };
    }
  }

  // Validate reset token
  async validateResetToken(token) {
    try {
      const user = await User.findByResetToken(token);
      if (!user) {
        return null;
      }

      const resetMeta = await redis.get(`reset_meta:${token}`);
      return { user, meta: resetMeta };
    } catch (error) {
      logger.error('Error validating reset token:', error);
      return null;
    }
  }

  // Complete password reset
  async completePasswordReset(token, newPassword) {
    try {
      const validation = await this.validateResetToken(token);
      if (!validation) {
        const error = new Error('Invalid or expired reset token');
        error.code = 'INVALID_RESET_TOKEN';
        throw error;
      }

      const { user } = validation;
      
      // Validate new password
      const passwordValidation = this.validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        const error = new Error('Password does not meet requirements: ' + passwordValidation.issues.join(', '));
        error.code = 'WEAK_PASSWORD';
        throw error;
      }

      // Update password
      await user.updatePassword(newPassword);
      await user.update({ 
        reset_token: null, 
        reset_token_expires: null 
      });

      // Clean up reset metadata
      await redis.del(`reset_meta:${token}`);

      return { success: true };
    } catch (error) {
      // Re-throw known errors
      if (error.code) {
        throw error;
      }
      
      // Handle unknown errors
      logger.error('Unexpected error in completePasswordReset:', error);
      const unknownError = new Error('Password reset failed. Please try again.');
      unknownError.code = 'RESET_ERROR';
      throw unknownError;
    }
  }

  // Get OTP session status
  async getOTPSessionStatus(sessionToken) {
    try {
      const sessionDataString = await redis.get(`otp:${sessionToken}`);
      if (!sessionDataString) {
        return null;
      }

      const sessionData = JSON.parse(sessionDataString);
      const now = new Date();
      const expiresAt = new Date(sessionData.expiresAt);
      const timeRemaining = Math.max(0, Math.floor((expiresAt - now) / 1000));

      return {
        isValid: timeRemaining > 0,
        timeRemaining,
        attemptsRemaining: sessionData.maxAttempts - sessionData.attempts,
        resendsRemaining: sessionData.maxResends - sessionData.resendCount,
        email: sessionData.email
      };
    } catch (error) {
      logger.error('Error getting OTP session status:', error);
      return null;
    }
  }

  // Clean expired OTP sessions
  async cleanExpiredOTPSessions() {
    try {
      // This would be called by a cron job
      // Implementation depends on Redis pattern matching capabilities
      logger.info('Cleaning expired OTP sessions');
      return true;
    } catch (error) {
      logger.error('Error cleaning expired OTP sessions:', error);
      return false;
    }
  }

  // Log security events
  logSecurityEvent(eventType, details) {
    try {
      logger.info(`Security Event: ${eventType}`, details);
    } catch (error) {
      logger.error('Error logging security event:', error);
    }
  }
}

module.exports = new AuthService();