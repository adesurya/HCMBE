// src/services/authService.js - Enhanced with OTP functionality
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
    const key = `lockout:${identifier}`;
    const lockout = await redis.get(key);
    return lockout !== null;
  }

  // Lock account temporarily
  async lockAccount(identifier) {
    const key = `lockout:${identifier}`;
    await redis.set(key, '1', this.lockoutDuration);
    
    logger.warn(`Account locked for ${identifier}`, {
      duration: this.lockoutDuration,
      timestamp: new Date().toISOString()
    });
  }

  // Track failed login attempt
  async trackFailedLogin(identifier, ip) {
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
  }

  // Clear failed login attempts
  async clearFailedAttempts(identifier) {
    const key = `failed_attempts:${identifier}`;
    await redis.del(key);
  }

  // Validate login attempt (Step 1 - Username/Password only)
  async validateLoginAttempt(email, password, ip) {
    // Check if account is locked
    if (await this.isAccountLocked(email)) {
      throw new Error('Account is temporarily locked due to too many failed login attempts');
    }

    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      await this.trackFailedLogin(email, ip);
      throw new Error('Invalid email or password');
    }

    // Check if account is active
    if (!user.is_active) {
      throw new Error('Account is deactivated');
    }

    // Check if email is verified
    if (!user.email_verified) {
      throw new Error('Please verify your email address before logging in');
    }

    // Verify password
    const isValidPassword = await user.verifyPassword(password);
    if (!isValidPassword) {
      const isLocked = await this.trackFailedLogin(email, ip);
      if (isLocked) {
        throw new Error('Too many failed attempts. Account is temporarily locked.');
      }
      throw new Error('Invalid email or password');
    }

    // Clear failed attempts on successful password verification
    await this.clearFailedAttempts(email);

    return user;
  }

  // Store OTP session data
  async storeOTPSession(userId, email, otp, sessionToken) {
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
  }

  // Validate OTP
  async validateOTP(sessionToken, inputOTP) {
    const sessionDataString = await redis.get(`otp:${sessionToken}`);
    if (!sessionDataString) {
      throw new Error('Invalid or expired verification session');
    }

    const sessionData = JSON.parse(sessionDataString);

    // Check if max attempts exceeded
    if (sessionData.attempts >= sessionData.maxAttempts) {
      await redis.del(`otp:${sessionToken}`);
      throw new Error('Maximum verification attempts exceeded. Please request a new code.');
    }

    // Check if OTP matches
    if (sessionData.otp !== inputOTP.toString()) {
      sessionData.attempts += 1;
      await redis.set(`otp:${sessionToken}`, JSON.stringify(sessionData), this.otpValidityDuration);
      
      const remainingAttempts = sessionData.maxAttempts - sessionData.attempts;
      throw new Error(`Invalid verification code. ${remainingAttempts} attempts remaining.`);
    }

    // OTP is valid
    await redis.del(`otp:${sessionToken}`);
    return sessionData;
  }

  // Resend OTP
  async resendOTP(sessionToken) {
    const sessionDataString = await redis.get(`otp:${sessionToken}`);
    if (!sessionDataString) {
      throw new Error('Invalid or expired verification session');
    }

    const sessionData = JSON.parse(sessionDataString);

    // Check if max resends exceeded
    if (sessionData.resendCount >= sessionData.maxResends) {
      throw new Error('Maximum resend attempts exceeded. Please start the login process again.');
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
  }

  // Validate session
  async validateSession(sessionId) {
    const sessionData = await redis.getSession(sessionId);
    if (!sessionData) {
      return null;
    }

    // Update last activity
    sessionData.lastActivity = new Date().toISOString();
    await redis.setSession(sessionId, sessionData, 24 * 60 * 60);

    return sessionData;
  }

  // Revoke session
  async revokeSession(sessionId) {
    await redis.deleteSession(sessionId);
  }

  // Get user sessions
  async getUserSessions(userId) {
    // This is a simplified implementation
    // In a real app, you'd maintain a user-to-sessions mapping
    const sessions = [];
    // Implementation would depend on your session storage strategy
    return sessions;
  }

  // Check for suspicious activity
  detectSuspiciousActivity(user, currentRequest) {
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
  }

  // Password reset flow
  async initiatePasswordReset(email) {
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
  }

  // Validate reset token
  async validateResetToken(token) {
    const user = await User.findByResetToken(token);
    if (!user) {
      return null;
    }

    const resetMeta = await redis.get(`reset_meta:${token}`);
    return { user, meta: resetMeta };
  }

  // Complete password reset
  async completePasswordReset(token, newPassword) {
    const validation = await this.validateResetToken(token);
    if (!validation) {
      throw new Error('Invalid or expired reset token');
    }

    const { user } = validation;
    
    // Validate new password
    const passwordValidation = this.validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      throw new Error('Password does not meet requirements: ' + passwordValidation.issues.join(', '));
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
  }

  // Get OTP session status
  async getOTPSessionStatus(sessionToken) {
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
  }

  // Clean expired OTP sessions
  async cleanExpiredOTPSessions() {
    // This would be called by a cron job
    // Implementation depends on Redis pattern matching capabilities
    logger.info('Cleaning expired OTP sessions');
  }

  // Log security events
  logSecurityEvent(eventType, details) {
    logger.security[eventType] && logger.security[eventType](details);
  }
}

module.exports = new AuthService();