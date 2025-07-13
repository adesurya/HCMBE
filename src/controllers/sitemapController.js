// src/controllers/sitemapController.js
const sitemapService = require('../services/sitemapService');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;

// Serve sitemap index
const getSitemapIndex = asyncHandler(async (req, res) => {
  try {
    const sitemapIndex = await sitemapService.generateSitemapIndex();
    
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'X-Robots-Tag': 'noindex'
    });
    
    res.send(sitemapIndex);
  } catch (error) {
    logger.error('Error serving sitemap index:', error);
    throw new AppError('Failed to generate sitemap index', 500);
  }
});

// Serve main sitemap
const getMainSitemap = asyncHandler(async (req, res) => {
  try {
    const mainSitemap = await sitemapService.generateMainSitemap();
    
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex'
    });
    
    res.send(mainSitemap);
  } catch (error) {
    logger.error('Error serving main sitemap:', error);
    throw new AppError('Failed to generate main sitemap', 500);
  }
});

// Serve news sitemap
const getNewsSitemap = asyncHandler(async (req, res) => {
  try {
    const newsSitemap = await sitemapService.generateNewsSitemap();
    
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600', // Cache for 10 minutes (news updates frequently)
      'X-Robots-Tag': 'noindex'
    });
    
    res.send(newsSitemap);
  } catch (error) {
    logger.error('Error serving news sitemap:', error);
    throw new AppError('Failed to generate news sitemap', 500);
  }
});

// Serve articles sitemap by page
const getArticlesSitemap = asyncHandler(async (req, res) => {
  try {
    const { page } = req.params;
    const pageNum = parseInt(page) || 1;
    
    if (pageNum < 1) {
      throw new AppError('Invalid page number', 400);
    }
    
    const articlesSitemap = await sitemapService.generateArticlesSitemap(pageNum);
    
    if (!articlesSitemap) {
      throw new AppError('Sitemap page not found', 404);
    }
    
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex'
    });
    
    res.send(articlesSitemap);
  } catch (error) {
    logger.error('Error serving articles sitemap:', error);
    if (error instanceof AppError) throw error;
    throw new AppError('Failed to generate articles sitemap', 500);
  }
});

// Generate all sitemaps (admin only)
const generateSitemaps = asyncHandler(async (req, res) => {
  try {
    const result = await sitemapService.generateAllSitemaps();
    
    res.json({
      success: true,
      message: 'Sitemaps generated successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error generating sitemaps:', error);
    throw new AppError('Failed to generate sitemaps', 500);
  }
});

// Get sitemap statistics (admin only)
const getSitemapStats = asyncHandler(async (req, res) => {
  try {
    const stats = await sitemapService.getSitemapStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting sitemap stats:', error);
    throw new AppError('Failed to get sitemap statistics', 500);
  }
});

// Clear sitemap cache (admin only)
const clearSitemapCache = asyncHandler(async (req, res) => {
  try {
    await sitemapService.clearSitemapCache();
    
    res.json({
      success: true,
      message: 'Sitemap cache cleared successfully'
    });
  } catch (error) {
    logger.error('Error clearing sitemap cache:', error);
    throw new AppError('Failed to clear sitemap cache', 500);
  }
});

// Ping search engines (admin only)
const pingSearchEngines = asyncHandler(async (req, res) => {
  try {
    const results = await sitemapService.pingSearchEngines();
    
    res.json({
      success: true,
      message: 'Search engines pinged',
      data: {
        ping_results: results
      }
    });
  } catch (error) {
    logger.error('Error pinging search engines:', error);
    throw new AppError('Failed to ping search engines', 500);
  }
});

// Serve robots.txt
const getRobotsTxt = asyncHandler(async (req, res) => {
  try {
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const siteName = process.env.SITE_NAME || 'News Portal';
    
    const robotsTxt = `# Robots.txt for ${siteName}
# Generated automatically

User-agent: *
Allow: /

# Disallow admin and private areas
Disallow: /admin/
Disallow: /api/
Disallow: /login
Disallow: /register
Disallow: /reset-password
Disallow: /verify-email
Disallow: /uploads/temp/
Disallow: /search?

# Allow specific API endpoints for crawling
Allow: /api/v1/articles
Allow: /api/v1/categories

# Crawl delay (be respectful)
Crawl-delay: 1

# Sitemaps
Sitemap: ${siteUrl}/sitemap.xml
Sitemap: ${siteUrl}/sitemap-news.xml

# Google News specific
User-agent: Googlebot-News
Allow: /
Crawl-delay: 0

# Bing specific
User-agent: bingbot
Allow: /
Crawl-delay: 1

# Prevent crawling of private files
Disallow: /*.json$
Disallow: /*.xml$
Disallow: /*.log$
Disallow: /*.txt$
Allow: /sitemap*.xml$
Allow: /robots.txt$

# Prevent crawling of duplicate content
Disallow: /*?page=
Disallow: /*?sort=
Disallow: /*?filter=
Disallow: /*&page=
Disallow: /*&sort=
Disallow: /*&filter=

# Mobile crawlers
User-agent: Googlebot-Mobile
Allow: /

# Image crawlers
User-agent: Googlebot-Image
Allow: /uploads/
Disallow: /uploads/temp/

# Archive crawlers
User-agent: ia_archiver
Allow: /

# Social media crawlers
User-agent: facebookexternalhit
Allow: /

User-agent: Twitterbot
Allow: /

User-agent: LinkedInBot
Allow: /

# News aggregators
User-agent: AppleBot
Allow: /

User-agent: YandexNews
Allow: /

# Last updated: ${new Date().toISOString()}
`;

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
    });
    
    res.send(robotsTxt);
  } catch (error) {
    logger.error('Error serving robots.txt:', error);
    throw new AppError('Failed to generate robots.txt', 500);
  }
});

// Serve ads.txt (for Google AdSense and other ad networks)
const getAdsTxt = asyncHandler(async (req, res) => {
  try {
    // You can customize this based on your ad network partnerships
    const adsTxt = `# ads.txt file for ${process.env.SITE_NAME || 'News Portal'}
# Generated automatically

# Google AdSense
# google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0

# Example entries (uncomment and modify as needed):
# google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
# googlesyndication.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0

# Other ad networks
# facebook.com, 1234567890, DIRECT, c3e20eee3f780d68
# rubiconproject.com, 12345, RESELLER, 0bfd66d529a55807

# Variables (replace with your actual values):
# DIRECT = Direct relationship
# RESELLER = Reseller relationship
# Replace pub-XXXXXXXXXXXXXXXX with your actual publisher ID

# Last updated: ${new Date().toISOString()}
`;

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    
    res.send(adsTxt);
  } catch (error) {
    logger.error('Error serving ads.txt:', error);
    throw new AppError('Failed to generate ads.txt', 500);
  }
});

// Serve human-readable sitemap page
const getSitemapPage = asyncHandler(async (req, res) => {
  try {
    const stats = await sitemapService.getSitemapStats();
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    
    const sitemapPage = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sitemap - ${process.env.SITE_NAME || 'News Portal'}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        h1, h2 { color: #333; }
        .stats { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .sitemap-list { list-style: none; padding: 0; }
        .sitemap-list li { margin: 10px 0; padding: 10px; background: #fff; border-left: 4px solid #007cba; }
        .sitemap-list a { text-decoration: none; color: #007cba; font-weight: bold; }
        .sitemap-list a:hover { text-decoration: underline; }
        .description { color: #666; font-size: 14px; margin-top: 5px; }
        .back-link { margin-top: 30px; }
        .back-link a { color: #007cba; text-decoration: none; }
    </style>
</head>
<body>
    <h1>XML Sitemaps</h1>
    
    <div class="stats">
        <h2>Sitemap Statistics</h2>
        <p><strong>Total Articles:</strong> ${stats.total_articles.toLocaleString()}</p>
        <p><strong>Categories:</strong> ${stats.total_categories}</p>
        <p><strong>Tags:</strong> ${stats.total_tags}</p>
        <p><strong>Recent News Articles:</strong> ${stats.recent_news}</p>
        <p><strong>Last Generated:</strong> ${new Date(stats.last_generated).toLocaleString()}</p>
    </div>

    <h2>Available Sitemaps</h2>
    <ul class="sitemap-list">
        <li>
            <a href="${siteUrl}/sitemap.xml">Main Sitemap Index</a>
            <div class="description">Contains links to all other sitemaps</div>
        </li>
        <li>
            <a href="${siteUrl}/sitemap-main.xml">Main Sitemap</a>
            <div class="description">Static pages, categories, and popular tags</div>
        </li>
        <li>
            <a href="${siteUrl}/sitemap-news.xml">News Sitemap</a>
            <div class="description">Recent articles (last 2 days) for Google News</div>
        </li>
        ${Array.from({length: stats.estimated_sitemaps - 3}, (_, i) => 
            `<li>
                <a href="${siteUrl}/sitemap-articles-${i + 1}.xml">Articles Sitemap ${i + 1}</a>
                <div class="description">Published articles (page ${i + 1})</div>
            </li>`
        ).join('')}
    </ul>

    <h2>Other Files</h2>
    <ul class="sitemap-list">
        <li>
            <a href="${siteUrl}/robots.txt">robots.txt</a>
            <div class="description">Robot crawling instructions for search engines</div>
        </li>
        <li>
            <a href="${siteUrl}/ads.txt">ads.txt</a>
            <div class="description">Authorized digital sellers for advertising</div>
        </li>
    </ul>

    <div class="back-link">
        <a href="${siteUrl}">← Back to Homepage</a>
    </div>
</body>
</html>`;

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    });
    
    res.send(sitemapPage);
  } catch (error) {
    logger.error('Error serving sitemap page:', error);
    throw new AppError('Failed to generate sitemap page', 500);
  }
});

module.exports = {
  getSitemapIndex,
  getMainSitemap,
  getNewsSitemap,
  getArticlesSitemap,
  generateSitemaps,
  getSitemapStats,
  clearSitemapCache,
  pingSearchEngines,
  getRobotsTxt,
  getAdsTxt,
  getSitemapPage
};