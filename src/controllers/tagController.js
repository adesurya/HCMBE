// src/controllers/tagController.js
const Tag = require('../models/Tag');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../../scripts/baksrc/utils/logger');

// Get all tags
const getTags = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    is_active,
    search,
    sortBy = 'name',
    sortOrder = 'ASC'
  } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder: sortOrder.toUpperCase()
  };

  if (is_active !== undefined) options.is_active = is_active === 'true';
  if (search) options.search = search;

  const result = await Tag.findAll(options);

  res.json({
    success: true,
    data: {
      tags: result.tags.map(tag => tag.toPublicObject()),
      pagination: result.pagination
    }
  });
});

// Get single tag
const getTag = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSlug = isNaN(id);

  let tag;
  if (isSlug) {
    tag = await Tag.findBySlug(id);
  } else {
    tag = await Tag.findById(parseInt(id));
  }

  if (!tag) {
    throw new AppError('Tag not found', 404);
  }

  // Get tag articles count
  const articleCount = await tag.getArticleCount();

  res.json({
    success: true,
    data: {
      tag: {
        ...tag.toPublicObject(),
        article_count: articleCount
      }
    }
  });
});

// Get popular tags
const getPopularTags = asyncHandler(async (req, res) => {
  const { limit = 20, days = 30 } = req.query;

  const popularTags = await Tag.getPopular(parseInt(limit), parseInt(days));

  res.json({
    success: true,
    data: {
      tags: popularTags.map(tag => tag.toPublicObject())
    }
  });
});

// Create new tag
const createTag = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    color = '#3498db',
    is_active = true
  } = req.body;

  const tagData = {
    name,
    description,
    color,
    is_active
  };

  const tag = await Tag.create(tagData);

  res.status(201).json({
    success: true,
    message: 'Tag created successfully',
    data: {
      tag: tag.toPublicObject()
    }
  });
});

// Update tag
const updateTag = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    color,
    is_active
  } = req.body;

  const tag = await Tag.findById(parseInt(id));
  if (!tag) {
    throw new AppError('Tag not found', 404);
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (color !== undefined) updates.color = color;
  if (is_active !== undefined) updates.is_active = is_active;

  await tag.update(updates);

  res.json({
    success: true,
    message: 'Tag updated successfully',
    data: {
      tag: tag.toPublicObject()
    }
  });
});

// Delete tag
const deleteTag = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const tag = await Tag.findById(parseInt(id));
  if (!tag) {
    throw new AppError('Tag not found', 404);
  }

  await tag.delete();

  res.json({
    success: true,
    message: 'Tag deleted successfully'
  });
});

// Get tag articles
const getTagArticles = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    page = 1,
    limit = 10,
    status = 'published',
    sortBy = 'published_at',
    sortOrder = 'DESC'
  } = req.query;

  const tag = await Tag.findById(parseInt(id));
  if (!tag) {
    throw new AppError('Tag not found', 404);
  }

  const result = await tag.getArticles(
    parseInt(page),
    parseInt(limit),
    status,
    sortBy,
    sortOrder.toUpperCase()
  );

  res.json({
    success: true,
    data: {
      tag: tag.toPublicObject(),
      articles: result.articles,
      pagination: result.pagination
    }
  });
});

// Merge tags
const mergeTags = asyncHandler(async (req, res) => {
  const { source_tag_id, target_tag_id } = req.body;

  if (source_tag_id === target_tag_id) {
    throw new AppError('Source and target tags must be different', 400);
  }

  const sourceTag = await Tag.findById(parseInt(source_tag_id));
  const targetTag = await Tag.findById(parseInt(target_tag_id));

  if (!sourceTag || !targetTag) {
    throw new AppError('One or both tags not found', 404);
  }

  await Tag.merge(source_tag_id, target_tag_id);

  res.json({
    success: true,
    message: `Tag "${sourceTag.name}" merged into "${targetTag.name}" successfully`
  });
});

// Get tag cloud data
const getTagCloud = asyncHandler(async (req, res) => {
  const { limit = 50, min_count = 1 } = req.query;

  const tagCloud = await Tag.getTagCloud(parseInt(limit), parseInt(min_count));

  res.json({
    success: true,
    data: {
      tag_cloud: tagCloud
    }
  });
});

module.exports = {
  getTags,
  getTag,
  getPopularTags,
  createTag,
  updateTag,
  deleteTag,
  getTagArticles,
  mergeTags,
  getTagCloud
};