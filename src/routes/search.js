// src/routes/search.js
const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { searchValidation, paginationValidation } = require('../middleware/validation');
const { rateLimiters } = require('../middleware/security');

// Search routes (rate limited)
router.get('/', rateLimiters.search, searchValidation, paginationValidation, searchController.searchArticles);
router.get('/suggestions', rateLimiters.search, searchController.getSearchSuggestions);
router.get('/trending', searchController.getTrendingSearches);

module.exports = router;