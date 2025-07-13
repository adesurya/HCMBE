// src/routes/sitemap.js
const express = require('express');
const router = express.Router();
const sitemapController = require('../controllers/sitemapController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { rateLimiters } = require('../middleware/rateLimiter');

// Public sitemap routes (no authentication required)
router.get('/sitemap.xml', rateLimiters.general, sitemapController.getSitemapIndex);
router.get('/sitemap-main.xml', rateLimiters.general, sitemapController.getMainSitemap);
router.get('/sitemap-news.xml', rateLimiters.general, sitemapController.getNewsSitemap);
router.get('/sitemap-articles-:page.xml', rateLimiters.general, sitemapController.getArticlesSitemap);

// Human-readable sitemap page
router.get('/sitemap', rateLimiters.general, sitemapController.getSitemapPage);

// SEO files
router.get('/robots.txt', rateLimiters.general, sitemapController.getRobotsTxt);
router.get('/ads.txt', rateLimiters.general, sitemapController.getAdsTxt);

// Admin routes for sitemap management
router.use('/admin', verifyToken, requireRole(['admin', 'editor']));

router.get('/admin/stats', sitemapController.getSitemapStats);
router.post('/admin/generate', sitemapController.generateSitemaps);
router.post('/admin/clear-cache', sitemapController.clearSitemapCache);
router.post('/admin/ping-search-engines', sitemapController.pingSearchEngines);

module.exports = router;