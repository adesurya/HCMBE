// src/controllers/categoryController.js
const Category = require('../models/Category');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Get all categories
const getCategories = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    is_active,
    parent_id,
    sortBy = 'sort_order',
    sortOrder = 'ASC'
  } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder: sortOrder.toUpperCase()
  };

  if (is_active !== undefined) options.is_active = is_active === 'true';
  if (parent_id !== undefined) options.parent_id = parent_id ? parseInt(parent_id) : null;

  const result = await Category.findAll(options);

  res.json({
    success: true,
    data: {
      categories: result.categories.map(category => category.toPublicObject()),
      pagination: result.pagination
    }
  });
});

// Get single category
const getCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSlug = isNaN(id);

  let category;
  if (isSlug) {
    category = await Category.findBySlug(id);
  } else {
    category = await Category.findById(parseInt(id));
  }

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  // Get category articles count
  const articleCount = await category.getArticleCount();

  res.json({
    success: true,
    data: {
      category: {
        ...category.toPublicObject(),
        article_count: articleCount
      }
    }
  });
});

// Get category tree (hierarchical structure)
const getCategoryTree = asyncHandler(async (req, res) => {
  const { is_active } = req.query;
  
  const tree = await Category.getTree(is_active === 'true');

  res.json({
    success: true,
    data: {
      categories: tree
    }
  });
});

// Create new category
const createCategory = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    parent_id,
    image,
    meta_title,
    meta_description,
    sort_order = 0,
    is_active = true
  } = req.body;

  const categoryData = {
    name,
    description,
    parent_id: parent_id ? parseInt(parent_id) : null,
    image,
    meta_title,
    meta_description,
    sort_order: parseInt(sort_order),
    is_active
  };

  const category = await Category.create(categoryData);

  res.status(201).json({
    success: true,
    message: 'Category created successfully',
    data: {
      category: category.toPublicObject()
    }
  });
});

// Update category
const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    parent_id,
    image,
    meta_title,
    meta_description,
    sort_order,
    is_active
  } = req.body;

  const category = await Category.findById(parseInt(id));
  if (!category) {
    throw new AppError('Category not found', 404);
  }

  // Prevent circular reference
  if (parent_id && parseInt(parent_id) === category.id) {
    throw new AppError('Category cannot be its own parent', 400);
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (parent_id !== undefined) updates.parent_id = parent_id ? parseInt(parent_id) : null;
  if (image !== undefined) updates.image = image;
  if (meta_title !== undefined) updates.meta_title = meta_title;
  if (meta_description !== undefined) updates.meta_description = meta_description;
  if (sort_order !== undefined) updates.sort_order = parseInt(sort_order);
  if (is_active !== undefined) updates.is_active = is_active;

  await category.update(updates);

  res.json({
    success: true,
    message: 'Category updated successfully',
    data: {
      category: category.toPublicObject()
    }
  });
});

// Delete category
const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const category = await Category.findById(parseInt(id));
  if (!category) {
    throw new AppError('Category not found', 404);
  }

  // Check if category has articles
  const articleCount = await category.getArticleCount();
  if (articleCount > 0) {
    throw new AppError('Cannot delete category with articles. Please reassign articles first.', 400);
  }

  // Check if category has children
  const hasChildren = await category.hasChildren();
  if (hasChildren) {
    throw new AppError('Cannot delete category with subcategories. Please delete subcategories first.', 400);
  }

  await category.delete();

  res.json({
    success: true,
    message: 'Category deleted successfully'
  });
});

// Get category articles
const getCategoryArticles = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    page = 1,
    limit = 10,
    status = 'published',
    sortBy = 'published_at',
    sortOrder = 'DESC'
  } = req.query;

  const category = await Category.findById(parseInt(id));
  if (!category) {
    throw new AppError('Category not found', 404);
  }

  const result = await category.getArticles(
    parseInt(page),
    parseInt(limit),
    status,
    sortBy,
    sortOrder.toUpperCase()
  );

  res.json({
    success: true,
    data: {
      category: category.toPublicObject(),
      articles: result.articles,
      pagination: result.pagination
    }
  });
});

// Reorder categories
const reorderCategories = asyncHandler(async (req, res) => {
  const { categories } = req.body; // Array of {id, sort_order}

  if (!Array.isArray(categories)) {
    throw new AppError('Categories must be an array', 400);
  }

  await Category.reorder(categories);

  res.json({
    success: true,
    message: 'Categories reordered successfully'
  });
});

module.exports = {
  getCategories,
  getCategory,
  getCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryArticles,
  reorderCategories
};