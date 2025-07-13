// src/controllers/authController.js - Enhanced with OTP
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
    throw new AppError('Failed to send verification code. Please try again.', 500);
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
});

// Step 2: Verify OTP and complete login
const verifyOTPAndLogin = asyncHandler(async (req, res) => {
  const { otpToken, otp } = req.body;

  if (!otpToken || !otp) {
    throw new AppError('OTP token and verification code are required', 400);
  }

  // Get OTP data from Redis
  const otpDataString = await redis.get(`otp:${otpToken}`);
  if (!otpDataString) {
    throw new AppError('Invalid or expired verification code', 400);
  }

  const otpData = JSON.parse(otpDataString);
  
  // Check if max attempts exceeded
  if (otpData.attempts >= otpData.maxAttempts) {
    await redis.del(`otp:${otpToken}`);
    throw new AppError('Maximum verification attempts exceeded. Please request a new code.', 400);
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
    
    throw new AppError(
      `Invalid verification code. ${remainingAttempts} attempts remaining.`, 
      400
    );
  }

  // OTP is valid, get user and complete login
  const user = await User.findById(otpData.userId);
  if (!user || !user.is_active) {
    await redis.del(`otp:${otpToken}`);
    throw new AppError('User not found or inactive', 401);
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
});

// Resend OTP
const resendOTP = asyncHandler(async (req, res) => {
  const { otpToken } = req.body;

  if (!otpToken) {
    throw new AppError('OTP token is required', 400);
  }

  // Get existing OTP data
  const otpDataString = await redis.get(`otp:${otpToken}`);
  if (!otpDataString) {
    throw new AppError('Invalid or expired session. Please start login again.', 400);
  }

  const otpData = JSON.parse(otpDataString);
  
  // Check rate limiting for resend (max 3 resends per session)
  const resendCount = otpData.resendCount || 0;
  if (resendCount >= 3) {
    throw new AppError('Maximum resend attempts exceeded. Please start login again.', 400);
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
    throw new AppError('User not found', 404);
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
    throw new AppError('Failed to send verification code. Please try again.', 500);
  }

  res.json({
    success: true,
    message: 'New verification code sent to your email',
    data: {
      resendCount: updatedOtpData.resendCount,
      remainingResends: 3 - updatedOtpData.resendCount
    }
  });
});

// Register new user (existing code with OTP verification)
const register = asyncHandler(async (req, res) => {
  const { username, email, password, first_name, last_name, role } = req.body;

  // Check if user already exists
  const existingUser = await User.findByEmailOrUsername(email, username);
  if (existingUser) {
    throw new AppError('User with this email or username already exists', 400);
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

  // Send verification email
  try {
    await emailService.sendVerificationEmail(user.email, user.verification_token);
  } catch (error) {
    logger.error('Failed to send verification email:', error);
  }

  res.status(201).json({
    success: true,
    message: 'User registered successfully. Please check your email for verification before logging in.',
    data: {
      user: user.toSafeObject()
    }
  });
});

// Logout user
const logout = asyncHandler(async (req, res) => {
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
});

// Refresh token (existing code)
const refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    throw new AppError('Refresh token not provided', 401);
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401);
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.is_active) {
      throw new AppError('User not found or inactive', 401);
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
    throw new AppError('Invalid refresh token', 401);
  }
});

// Get current user profile
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: {
      user: user.toSafeObject()
    }
  });
});

// Update profile (existing code)
const updateProfile = asyncHandler(async (req, res) => {
  const { username, email, first_name, last_name, bio } = req.body;
  
  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Check if username or email is being changed and already exists
  if (username && username !== user.username) {
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      throw new AppError('Username already taken', 400);
    }
  }

  if (email && email !== user.email) {
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      throw new AppError('Email already taken', 400);
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
});

// Change password (existing code)
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Verify current password
  const isCurrentPasswordValid = await user.verifyPassword(currentPassword);
  if (!isCurrentPasswordValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Update password
  await user.updatePassword(newPassword);

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
});

// Upload profile image (existing code)
const uploadProfileImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No image file provided', 400);
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
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
});

// Forgot password (existing code)
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

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
    throw new AppError('Failed to send password reset email', 500);
  }
});

// Reset password (existing code)
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  const user = await User.findByResetToken(token);
  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
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
});

// Verify email (existing code)
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const user = await User.findByVerificationToken(token);
  if (!user) {
    throw new AppError('Invalid verification token', 400);
  }

  await user.verifyEmail();

  res.json({
    success: true,
    message: 'Email verified successfully'
  });
});

// Resend verification email (existing code)
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findByEmail(email);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.email_verified) {
    throw new AppError('Email already verified', 400);
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
    throw new AppError('Failed to send verification email', 500);
  }
});

// Check authentication status
const checkAuth = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      isAuthenticated: true,
      user: req.user
    }
  });
});

// Get user permissions
const getPermissions = asyncHandler(async (req, res) => {
  const permissions = authService.getUserPermissions(req.user.role);

  res.json({
    success: true,
    data: {
      role: req.user.role,
      permissions
    }
  });
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