// src/controllers/userController.js
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

// Get all users
const getUsers = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    role,
    is_active,
    search,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder: sortOrder.toUpperCase()
  };

  if (role) options.role = role;
  if (is_active !== undefined) options.is_active = is_active === 'true';
  if (search) options.search = search;

  const result = await User.findAll(options);

  res.json({
    success: true,
    data: {
      users: result.users.map(user => user.toSafeObject()),
      pagination: result.pagination
    }
  });
});

// Get single user
const getUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await User.findById(parseInt(id));

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Get user statistics
  const stats = await user.getStatistics();

  res.json({
    success: true,
    data: {
      user: {
        ...user.toSafeObject(),
        statistics: stats
      }
    }
  });
});

// Create new user (admin only)
const createUser = asyncHandler(async (req, res) => {
  const {
    username,
    email,
    password,
    first_name,
    last_name,
    role = 'user',
    is_active = true
  } = req.body;

  const userData = {
    username,
    email,
    password,
    first_name,
    last_name,
    role,
    is_active
  };

  const user = await User.create(userData);

  // Send welcome email
  try {
    await emailService.sendWelcomeEmail(user);
  } catch (error) {
    logger.error('Failed to send welcome email:', error);
  }

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: {
      user: user.toSafeObject()
    }
  });
});

// Update user
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    username,
    email,
    first_name,
    last_name,
    role,
    is_active,
    bio
  } = req.body;

  const user = await User.findById(parseInt(id));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const oldRole = user.role;
  const updates = {};
  
  if (username !== undefined) updates.username = username;
  if (email !== undefined) updates.email = email;
  if (first_name !== undefined) updates.first_name = first_name;
  if (last_name !== undefined) updates.last_name = last_name;
  if (role !== undefined) updates.role = role;
  if (is_active !== undefined) updates.is_active = is_active;
  if (bio !== undefined) updates.bio = bio;

  await user.update(updates);

  // Send role change notification if role changed
  if (role && role !== oldRole) {
    try {
      await emailService.sendRoleChangeNotification(user, oldRole, role);
    } catch (error) {
      logger.error('Failed to send role change notification:', error);
    }
  }

  res.json({
    success: true,
    message: 'User updated successfully',
    data: {
      user: user.toSafeObject()
    }
  });
});

// Delete user (soft delete)
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (parseInt(id) === req.user.id) {
    throw new AppError('You cannot delete your own account', 400);
  }

  const user = await User.findById(parseInt(id));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.delete();

  res.json({
    success: true,
    message: 'User deleted successfully'
  });
});

// Activate user
const activateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(parseInt(id));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.update({ is_active: true });

  res.json({
    success: true,
    message: 'User activated successfully',
    data: {
      user: user.toSafeObject()
    }
  });
});

// Deactivate user
const deactivateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (parseInt(id) === req.user.id) {
    throw new AppError('You cannot deactivate your own account', 400);
  }

  const user = await User.findById(parseInt(id));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.update({ is_active: false });

  // Send deactivation notification
  try {
    await emailService.sendAccountDeactivationNotification(user.email, reason);
  } catch (error) {
    logger.error('Failed to send deactivation notification:', error);
  }

  res.json({
    success: true,
    message: 'User deactivated successfully'
  });
});

// Reset user password (admin only)
const resetUserPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;

  const user = await User.findById(parseInt(id));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.updatePassword(new_password);

  res.json({
    success: true,
    message: 'Password reset successfully'
  });
});

// Get user articles
const getUserArticles = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    page = 1,
    limit = 10,
    status,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const user = await User.findById(parseInt(id));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const result = await user.getArticles(
    parseInt(page),
    parseInt(limit),
    status,
    sortBy,
    sortOrder.toUpperCase()
  );

  res.json({
    success: true,
    data: {
      user: user.toPublicObject(),
      articles: result.articles,
      pagination: result.pagination
    }
  });
});

// Get user comments
const getUserComments = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    page = 1,
    limit = 10,
    status,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const user = await User.findById(parseInt(id));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const result = await user.getComments(
    parseInt(page),
    parseInt(limit),
    status,
    sortBy,
    sortOrder.toUpperCase()
  );

  res.json({
    success: true,
    data: {
      user: user.toPublicObject(),
      comments: result.comments,
      pagination: result.pagination
    }
  });
});

// Bulk user actions
const bulkUserAction = asyncHandler(async (req, res) => {
  const { user_ids, action, data } = req.body;

  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    throw new AppError('User IDs must be a non-empty array', 400);
  }

  const allowedActions = ['activate', 'deactivate', 'change_role', 'delete'];
  if (!allowedActions.includes(action)) {
    throw new AppError('Invalid action', 400);
  }

  // Prevent self-modification
  if (user_ids.includes(req.user.id)) {
    throw new AppError('You cannot perform bulk actions on your own account', 400);
  }

  const results = await User.bulkAction(user_ids, action, data);

  res.json({
    success: true,
    message: `Bulk ${action} completed`,
    data: {
      processed: results.processed,
      failed: results.failed
    }
  });
});

// Export users (admin only)
const exportUsers = asyncHandler(async (req, res) => {
  const { 
    format = 'csv',
    role,
    is_active,
    include_stats = false
  } = req.query;

  const exportData = await User.exportUsers({
    format,
    role,
    is_active: is_active !== undefined ? is_active === 'true' : undefined,
    include_stats: include_stats === 'true'
  });

  const filename = `users_export_${Date.now()}.${format}`;
  
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');

  res.send(exportData);
});

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  activateUser,
  deactivateUser,
  resetUserPassword,
  getUserArticles,
  getUserComments,
  bulkUserAction,
  exportUsers
};