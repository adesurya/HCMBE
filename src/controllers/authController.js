// src/controllers/authController.js
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const crypto = require('crypto');

// Register new user
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

  // Generate tokens
  const token = user.generateToken();
  const refreshToken = user.generateRefreshToken();

  // Set cookie for refresh token
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully. Please check your email for verification.',
    data: {
      user: user.toSafeObject(),
      token
    }
  });
});

// Login user
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user by email
  const user = await User.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  // Check if user is active
  if (!user.is_active) {
    throw new AppError('Account is deactivated', 401);
  }

  // Verify password
  const isPasswordValid = await user.verifyPassword(password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  // Update last login
  await user.updateLastLogin();

  // Generate tokens
  const token = user.generateToken();
  const refreshToken = user.generateRefreshToken();

  // Set cookie for refresh token
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: user.toSafeObject(),
      token
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

  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// Refresh token
const refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    throw new AppError('Refresh token not provided', 401);
  }

  try {
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

// Update profile
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

// Change password
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

// Upload profile image
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

// Forgot password
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

// Reset password
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

// Verify email
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

// Resend verification email
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

  const userPermissions = permissions[req.user.role] || permissions.user;

  res.json({
    success: true,
    data: {
      role: req.user.role,
      permissions: userPermissions
    }
  });
});

module.exports = {
  register,
  login,
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