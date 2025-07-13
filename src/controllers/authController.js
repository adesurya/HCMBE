// src/controllers/authController.js - Fixed version with proper error handling
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const emailService = require('../services/emailService');
const authService = require('../services/authService');
const redis = require('../config/redis');
const logger = require('../../scripts/baksrc/utils/logger');
const crypto = require('crypto');

// Step 1: Initial login (username/password verification)
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate credentials using auth service
    const user = await authService.validateLoginAttempt(email, password, req.ip);

    // Generate OTP and store temporarily
    const otp = authService.generateOTP();
    const otpToken = crypto.randomBytes(32).toString('hex');
    
    // Store OTP data in Redis (expires in 10 minutes)
    await redis.set(`otp:${otpToken}`, JSON.stringify({
      userId: user.id,
      email: user.email,
      otp: otp,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString()
    }), 600); // 10 minutes

    // Send OTP via email
    try {
      await emailService.sendOTPEmail(user.email, otp, user.first_name || user.username);
      
      logger.info('OTP sent for login', {
        userId: user.id,
        email: user.email,
        ip: req.ip
      });
    } catch (error) {
      logger.error('Failed to send OTP email:', error);
      // Don't crash, just inform user
      return res.status(500).json({
        success: false,
        error: 'Failed to send verification code. Please try again or contact support.',
        code: 'EMAIL_SEND_FAILED'
      });
    }

    res.json({
      success: true,
      message: 'Verification code sent to your email. Please check your inbox.',
      data: {
        otpToken,
        email: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'), // Masked email
        expiresIn: 600 // 10 minutes
      }
    });
  } catch (error) {
    // Log the error for debugging
    logger.warn('Login attempt failed', {
      email,
      ip: req.ip,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    // Return consistent error response for security
    return res.status(401).json({
      success: false,
      error: error.message,
      code: 'LOGIN_FAILED'
    });
  }
});

// Step 2: Verify OTP and complete login
const verifyOTPAndLogin = asyncHandler(async (req, res) => {
  const { otpToken, otp } = req.body;

  if (!otpToken || !otp) {
    return res.status(400).json({
      success: false,
      error: 'OTP token and verification code are required',
      code: 'MISSING_PARAMETERS'
    });
  }

  try {
    // Get OTP data from Redis
    const otpDataString = await redis.get(`otp:${otpToken}`);
    if (!otpDataString) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification code',
        code: 'INVALID_OTP_SESSION'
      });
    }

    const otpData = JSON.parse(otpDataString);
    
    // Check if max attempts exceeded
    if (otpData.attempts >= otpData.maxAttempts) {
      await redis.del(`otp:${otpToken}`);
      return res.status(400).json({
        success: false,
        error: 'Maximum verification attempts exceeded. Please request a new code.',
        code: 'MAX_ATTEMPTS_EXCEEDED'
      });
    }

    // Verify OTP
    if (otpData.otp !== otp.toString()) {
      // Increment attempts
      otpData.attempts += 1;
      await redis.set(`otp:${otpToken}`, JSON.stringify(otpData), 600);
      
      const remainingAttempts = otpData.maxAttempts - otpData.attempts;
      
      logger.warn('Invalid OTP attempt', {
        userId: otpData.userId,
        attempts: otpData.attempts,
        ip: req.ip
      });
      
      return res.status(400).json({
        success: false,
        error: `Invalid verification code. ${remainingAttempts} attempts remaining.`,
        code: 'INVALID_OTP',
        remainingAttempts
      });
    }

    // OTP is valid, get user and complete login
    const user = await User.findById(otpData.userId);
    if (!user || !user.is_active) {
      await redis.del(`otp:${otpToken}`);
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive',
        code: 'USER_INACTIVE'
      });
    }

    // Update last login
    await user.updateLastLogin();

    // Generate JWT tokens
    const token = user.generateToken();
    const refreshToken = user.generateRefreshToken();

    // Set refresh token cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Clean up OTP data
    await redis.del(`otp:${otpToken}`);

    // Log successful login
    logger.info('Successful login with OTP', {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toSafeObject(),
        token,
        permissions: authService.getUserPermissions(user.role)
      }
    });
  } catch (error) {
    logger.error('OTP verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred during verification. Please try again.',
      code: 'VERIFICATION_ERROR'
    });
  }
});

// Resend OTP
const resendOTP = asyncHandler(async (req, res) => {
  const { otpToken } = req.body;

  if (!otpToken) {
    return res.status(400).json({
      success: false,
      error: 'OTP token is required',
      code: 'MISSING_OTP_TOKEN'
    });
  }

  try {
    // Get existing OTP data
    const otpDataString = await redis.get(`otp:${otpToken}`);
    if (!otpDataString) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired session. Please start login again.',
        code: 'INVALID_SESSION'
      });
    }

    const otpData = JSON.parse(otpDataString);
    
    // Check rate limiting for resend (max 3 resends per session)
    const resendCount = otpData.resendCount || 0;
    if (resendCount >= 3) {
      return res.status(400).json({
        success: false,
        error: 'Maximum resend attempts exceeded. Please start login again.',
        code: 'MAX_RESENDS_EXCEEDED'
      });
    }

    // Generate new OTP
    const newOTP = authService.generateOTP();
    
    // Update OTP data
    const updatedOtpData = {
      ...otpData,
      otp: newOTP,
      attempts: 0,
      resendCount: resendCount + 1,
      lastResent: new Date().toISOString()
    };

    await redis.set(`otp:${otpToken}`, JSON.stringify(updatedOtpData), 600);

    // Get user for email
    const user = await User.findById(otpData.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Send new OTP
    try {
      await emailService.sendOTPEmail(user.email, newOTP, user.first_name || user.username);
      
      logger.info('OTP resent', {
        userId: user.id,
        resendCount: updatedOtpData.resendCount,
        ip: req.ip
      });
    } catch (error) {
      logger.error('Failed to resend OTP:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send verification code. Please try again.',
        code: 'EMAIL_SEND_FAILED'
      });
    }

    res.json({
      success: true,
      message: 'New verification code sent to your email',
      data: {
        resendCount: updatedOtpData.resendCount,
        remainingResends: 3 - updatedOtpData.resendCount
      }
    });
  } catch (error) {
    logger.error('Resend OTP error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while resending verification code.',
      code: 'RESEND_ERROR'
    });
  }
});

// Register new user (existing code with OTP verification)
const register = asyncHandler(async (req, res) => {
  const { username, email, password, first_name, last_name, role } = req.body;

  try {
    // Check if user already exists
    const existingUser = await User.findByEmailOrUsername(email, username);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email or username already exists',
        code: 'USER_EXISTS'
      });
    }

    // Create user
    const user = await User.create({
      username,
      email,
      password,
      first_name,
      last_name,
      role: role || 'user'
    });

    // Send verification email (don't fail if email fails)
    try {
      await emailService.sendVerificationEmail(user.email, user.verification_token);
    } catch (error) {
      logger.error('Failed to send verification email:', error);
      // Continue with registration success
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please check your email for verification before logging in.',
      data: {
        user: user.toSafeObject()
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Registration failed. Please try again.',
      code: 'REGISTRATION_ERROR'
    });
  }
});

// Logout user
const logout = asyncHandler(async (req, res) => {
  try {
    // Clear refresh token cookie
    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(0)
    });

    // Log logout
    logger.info('User logged out', {
      userId: req.user?.id,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      error: 'Logout failed',
      code: 'LOGOUT_ERROR'
    });
  }
});

// Refresh token (existing code)
const refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      error: 'Refresh token not provided',
      code: 'NO_REFRESH_TOKEN'
    });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token type',
        code: 'INVALID_TOKEN_TYPE'
      });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive',
        code: 'USER_INACTIVE'
      });
    }

    // Generate new tokens
    const newToken = user.generateToken();
    const newRefreshToken = user.generateRefreshToken();

    // Set new refresh token cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      data: {
        token: newToken
      }
    });
  } catch (error) {
    logger.error('Refresh token error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid refresh token',
      code: 'INVALID_REFRESH_TOKEN'
    });
  }
});

// Get current user profile
const getProfile = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        user: user.toSafeObject()
      }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get profile',
      code: 'PROFILE_ERROR'
    });
  }
});

// Update profile (existing code)
const updateProfile = asyncHandler(async (req, res) => {
  const { username, email, first_name, last_name, bio } = req.body;
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if username or email is being changed and already exists
    if (username && username !== user.username) {
      const existingUser = await User.findByUsername(username);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Username already taken',
          code: 'USERNAME_EXISTS'
        });
      }
    }

    if (email && email !== user.email) {
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Email already taken',
          code: 'EMAIL_EXISTS'
        });
      }
    }

    const updates = {};
    if (username !== undefined) updates.username = username;
    if (email !== undefined) updates.email = email;
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (bio !== undefined) updates.bio = bio;

    await user.update(updates);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: user.toSafeObject()
      }
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      code: 'UPDATE_PROFILE_ERROR'
    });
  }
});

// Change password (existing code)
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.verifyPassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect',
        code: 'INVALID_CURRENT_PASSWORD'
      });
    }

    // Update password
    await user.updatePassword(newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to change password',
      code: 'CHANGE_PASSWORD_ERROR'
    });
  }
});

// Upload profile image (existing code)
const uploadProfileImage = asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided',
        code: 'NO_FILE'
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Process and save image (implementation depends on your image service)
    const imageUrl = `/uploads/profiles/${req.file.safeFileName}`;
    
    await user.update({ profile_image: imageUrl });

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        profile_image: imageUrl
      }
    });
  } catch (error) {
    logger.error('Upload profile image error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload profile image',
      code: 'UPLOAD_ERROR'
    });
  }
});

// Forgot password (existing code)
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists or not
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = await user.generateResetToken();

    // Send reset email
    try {
      await emailService.sendPasswordResetEmail(user.email, resetToken);
      
      res.json({
        success: true,
        message: 'Password reset link has been sent to your email.'
      });
    } catch (error) {
      logger.error('Failed to send password reset email:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send password reset email',
        code: 'EMAIL_SEND_FAILED'
      });
    }
  } catch (error) {
    logger.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred. Please try again.',
      code: 'FORGOT_PASSWORD_ERROR'
    });
  }
});

// Reset password (existing code)
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const user = await User.findByResetToken(token);
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token',
        code: 'INVALID_RESET_TOKEN'
      });
    }

    // Update password and clear reset token
    await user.updatePassword(newPassword);
    await user.update({ 
      reset_token: null, 
      reset_token_expires: null 
    });

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reset password',
      code: 'RESET_PASSWORD_ERROR'
    });
  }
});

// Verify email (existing code)
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;

  try {
    const user = await User.findByVerificationToken(token);
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid verification token',
        code: 'INVALID_VERIFICATION_TOKEN'
      });
    }

    await user.verifyEmail();

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    logger.error('Verify email error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify email',
      code: 'VERIFY_EMAIL_ERROR'
    });
  }
});

// Resend verification email (existing code)
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email already verified',
        code: 'EMAIL_ALREADY_VERIFIED'
      });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    await user.update({ verification_token: verificationToken });

    // Send verification email
    try {
      await emailService.sendVerificationEmail(user.email, verificationToken);
      
      res.json({
        success: true,
        message: 'Verification email sent successfully'
      });
    } catch (error) {
      logger.error('Failed to send verification email:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send verification email',
        code: 'EMAIL_SEND_FAILED'
      });
    }
  } catch (error) {
    logger.error('Resend verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to resend verification email',
      code: 'RESEND_VERIFICATION_ERROR'
    });
  }
});

// Check authentication status
const checkAuth = asyncHandler(async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        isAuthenticated: true,
        user: req.user
      }
    });
  } catch (error) {
    logger.error('Check auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication check failed',
      code: 'AUTH_CHECK_ERROR'
    });
  }
});

// Get user permissions
const getPermissions = asyncHandler(async (req, res) => {
  try {
    const permissions = authService.getUserPermissions(req.user.role);

    res.json({
      success: true,
      data: {
        role: req.user.role,
        permissions
      }
    });
  } catch (error) {
    logger.error('Get permissions error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get permissions',
      code: 'PERMISSIONS_ERROR'
    });
  }
});

module.exports = {
  register,
  login,
  verifyOTPAndLogin,
  resendOTP,
  logout,
  refreshToken,
  getProfile,
  updateProfile,
  changePassword,
  uploadProfileImage,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  checkAuth,
  getPermissions
};