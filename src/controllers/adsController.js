// src/controllers/adsController.js
const Ads = require('../models/Ads');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../../scripts/baksrc/utils/logger');

// Get all ads
const getAds = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    position,
    type,
    is_active,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder: sortOrder.toUpperCase()
  };

  if (position) options.position = position;
  if (type) options.type = type;
  if (is_active !== undefined) options.is_active = is_active === 'true';

  const result = await Ads.findAll(options);

  res.json({
    success: true,
    data: {
      ads: result.ads,
      pagination: result.pagination
    }
  });
});

// Get single ad
const getAd = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ad = await Ads.findById(parseInt(id));

  if (!ad) {
    throw new AppError('Ad not found', 404);
  }

  res.json({
    success: true,
    data: {
      ad: ad.toPublicObject()
    }
  });
});

// Get ads by position (public)
const getAdsByPosition = asyncHandler(async (req, res) => {
  const { position } = req.params;
  const ads = await Ads.findByPosition(position, true); // only active ads

  res.json({
    success: true,
    data: {
      ads: ads.map(ad => ad.toPublicObject())
    }
  });
});

// Create new ad
const createAd = asyncHandler(async (req, res) => {
  const {
    title,
    type,
    position,
    content,
    image_url,
    link_url,
    target_blank = true,
    width,
    height,
    is_active = true,
    start_date,
    end_date
  } = req.body;

  const adData = {
    title,
    type,
    position,
    content,
    image_url,
    link_url,
    target_blank,
    width,
    height,
    is_active,
    start_date: start_date ? new Date(start_date) : null,
    end_date: end_date ? new Date(end_date) : null
  };

  const ad = await Ads.create(adData, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Ad created successfully',
    data: {
      ad: ad.toPublicObject()
    }
  });
});

// Update ad
const updateAd = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    title,
    type,
    position,
    content,
    image_url,
    link_url,
    target_blank,
    width,
    height,
    is_active,
    start_date,
    end_date
  } = req.body;

  const ad = await Ads.findById(parseInt(id));
  if (!ad) {
    throw new AppError('Ad not found', 404);
  }

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (type !== undefined) updates.type = type;
  if (position !== undefined) updates.position = position;
  if (content !== undefined) updates.content = content;
  if (image_url !== undefined) updates.image_url = image_url;
  if (link_url !== undefined) updates.link_url = link_url;
  if (target_blank !== undefined) updates.target_blank = target_blank;
  if (width !== undefined) updates.width = width;
  if (height !== undefined) updates.height = height;
  if (is_active !== undefined) updates.is_active = is_active;
  if (start_date !== undefined) updates.start_date = start_date ? new Date(start_date) : null;
  if (end_date !== undefined) updates.end_date = end_date ? new Date(end_date) : null;

  await ad.update(updates);

  res.json({
    success: true,
    message: 'Ad updated successfully',
    data: {
      ad: ad.toPublicObject()
    }
  });
});

// Delete ad
const deleteAd = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const ad = await Ads.findById(parseInt(id));
  if (!ad) {
    throw new AppError('Ad not found', 404);
  }

  await ad.delete();

  res.json({
    success: true,
    message: 'Ad deleted successfully'
  });
});

// Track ad impression
const trackImpression = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const ad = await Ads.findById(parseInt(id));
  if (!ad) {
    throw new AppError('Ad not found', 404);
  }

  await ad.incrementImpressions();

  res.json({
    success: true,
    message: 'Impression tracked'
  });
});

// Track ad click
const trackClick = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const ad = await Ads.findById(parseInt(id));
  if (!ad) {
    throw new AppError('Ad not found', 404);
  }

  await ad.incrementClicks();

  res.json({
    success: true,
    message: 'Click tracked',
    data: {
      redirect_url: ad.link_url
    }
  });
});

// Get ad statistics
const getAdStats = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { days = 30 } = req.query;

  const ad = await Ads.findById(parseInt(id));
  if (!ad) {
    throw new AppError('Ad not found', 404);
  }

  const stats = await ad.getStatistics(parseInt(days));

  res.json({
    success: true,
    data: {
      stats
    }
  });
});

module.exports = {
  getAds,
  getAd,
  getAdsByPosition,
  createAd,
  updateAd,
  deleteAd,
  trackImpression,
  trackClick,
  getAdStats
};
