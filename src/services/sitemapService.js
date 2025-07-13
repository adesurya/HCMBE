// src/services/sitemapService.js - V2 with Database Helper
const dbHelper = require('../utils/databaseHelper');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

class SitemapService {
  constructor() {
    this.siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    this.sitemapPath = path.join(__dirname, '../../public/sitemaps');
    this.cache_ttl = 3600; // 1 hour cache
    this.maxUrlsPerSitemap = 50000; // Google limit
    
    // Ensure sitemaps directory exists
    this.ensureSitemapDirectory();
  }

  async ensureSitemapDirectory() {
    try {
      await fs.mkdir(this.sitemapPath, { recursive: true });
    } catch (error) {
      logger.error('Error creating sitemap directory:', error);
    }
  }

  // Generate XML sitemap header
  generateSitemapHeader() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`;
  }

  // Generate XML sitemap footer
  generateSitemapFooter() {
    return '</urlset>';
  }

  // Generate sitemap index header
  generateSitemapIndexHeader() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
  }

  // Generate sitemap index footer
  generateSitemapIndexFooter() {
    return '</sitemapindex>';
  }

  // Format date for sitemap
  formatSitemapDate(date) {
    return new Date(date).toISOString();
  }

  // Escape XML entities
  escapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Generate URL entry for sitemap
  generateUrlEntry(url, lastmod = null, changefreq = 'weekly', priority = '0.5', isNews = false, newsData = null, images = []) {
    let entry = `  <url>
    <loc>${this.escapeXml(url)}</loc>`;
    
    if (lastmod) {
      entry += `
    <lastmod>${this.formatSitemapDate(lastmod)}</lastmod>`;
    }
    
    entry += `
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>`;

    // Add news data for Google News
    if (isNews && newsData) {
      entry += `
    <news:news>
      <news:publication>
        <news:name>${this.escapeXml(newsData.publicationName)}</news:name>
        <news:language>${newsData.language || 'en'}</news:language>
      </news:publication>
      <news:publication_date>${this.formatSitemapDate(newsData.publishDate)}</news:publication_date>
      <news:title>${this.escapeXml(newsData.title)}</news:title>`;
      
      if (newsData.keywords) {
        entry += `
      <news:keywords>${this.escapeXml(newsData.keywords)}</news:keywords>`;
      }
      
      entry += `
    </news:news>`;
    }

    // Add image data
    if (images && images.length > 0) {
      images.forEach(image => {
        entry += `
    <image:image>
      <image:loc>${this.escapeXml(image.url)}</image:loc>`;
        
        if (image.caption) {
          entry += `
      <image:caption>${this.escapeXml(image.caption)}</image:caption>`;
        }
        
        if (image.title) {
          entry += `
      <image:title>${this.escapeXml(image.title)}</image:title>`;
        }
        
        entry += `
    </image:image>`;
      });
    }

    entry += `
  </url>`;
    
    return entry;
  }

  // Generate main sitemap with static pages
  async generateMainSitemap() {
    const cacheKey = 'sitemap:main';
    
    return await redis.cache(cacheKey, async () => {
      let sitemap = this.generateSitemapHeader();
      
      // Static pages
      const staticPages = [
        { url: this.siteUrl, changefreq: 'daily', priority: '1.0' },
        { url: `${this.siteUrl}/about`, changefreq: 'monthly', priority: '0.7' },
        { url: `${this.siteUrl}/contact`, changefreq: 'monthly', priority: '0.7' },
        { url: `${this.siteUrl}/privacy`, changefreq: 'yearly', priority: '0.3' },
        { url: `${this.siteUrl}/terms`, changefreq: 'yearly', priority: '0.3' },
        { url: `${this.siteUrl}/sitemap`, changefreq: 'weekly', priority: '0.5' }
      ];

      staticPages.forEach(page => {
        sitemap += this.generateUrlEntry(page.url, new Date(), page.changefreq, page.priority);
      });

      try {
        // Categories using database helper
        const categories = await dbHelper.getCategoriesForSitemap();
        categories.forEach(category => {
          const url = `${this.siteUrl}/category/${category.slug}`;
          sitemap += this.generateUrlEntry(url, category.updated_at, 'weekly', '0.8');
        });

        // Tags using database helper
        const tags = await dbHelper.getTagsForSitemap(100);
        tags.forEach(tag => {
          const url = `${this.siteUrl}/tag/${tag.slug}`;
          sitemap += this.generateUrlEntry(url, tag.updated_at, 'weekly', '0.6');
        });

      } catch (error) {
        logger.error('Error generating main sitemap sections:', error);
        // Continue with static pages only
      }

      sitemap += this.generateSitemapFooter();
      return sitemap;
    }, this.cache_ttl);
  }

  // Generate articles sitemap using database helper
  async generateArticlesSitemap(page = 1, limit = 1000) {
    const pageInt = parseInt(page) || 1;
    const cacheKey = `sitemap:articles:${pageInt}`;
    
    return await redis.cache(cacheKey, async () => {
      try {
        // Try using database helper first
        let articles;
        try {
          articles = await dbHelper.getArticlesForSitemap(pageInt, limit);
        } catch (error) {
          logger.warn('Primary articles query failed, trying fallback:', error.message);
          // Fallback to non-parameterized query
          articles = await dbHelper.getArticlesForSitemapFallback(pageInt, limit);
        }

        if (!articles || articles.length === 0) {
          return null;
        }

        let sitemap = this.generateSitemapHeader();

        for (const article of articles) {
          const url = `${this.siteUrl}/articles/${article.slug}`;
          const images = [];
          
          // Add featured image if exists
          if (article.featured_image) {
            const imageUrl = article.featured_image.startsWith('http') 
              ? article.featured_image 
              : `${this.siteUrl}${article.featured_image}`;
            
            images.push({
              url: imageUrl,
              title: article.title,
              caption: `Featured image for ${article.title}`
            });
          }

          // Determine if it's news (published within last 2 days for Google News)
          const isRecentNews = new Date(article.published_at) > new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
          
          let newsData = null;
          if (isRecentNews) {
            newsData = {
              publicationName: process.env.SITE_NAME || 'News Portal',
              language: 'en',
              publishDate: article.published_at,
              title: article.title,
              keywords: article.meta_keywords || article.category_name
            };
          }

          sitemap += this.generateUrlEntry(
            url,
            article.updated_at,
            'weekly',
            '0.9',
            isRecentNews,
            newsData,
            images
          );
        }

        sitemap += this.generateSitemapFooter();
        return sitemap;
      } catch (error) {
        logger.error('Error generating articles sitemap:', error);
        throw error;
      }
    }, this.cache_ttl);
  }

  // Generate Google News specific sitemap
  async generateNewsSitemap() {
    const cacheKey = 'sitemap:news';
    
    return await redis.cache(cacheKey, async () => {
      try {
        const articles = await dbHelper.getNewsArticles();

        let sitemap = this.generateSitemapHeader();

        articles.forEach(article => {
          const url = `${this.siteUrl}/articles/${article.slug}`;
          const images = [];
          
          if (article.featured_image) {
            const imageUrl = article.featured_image.startsWith('http') 
              ? article.featured_image 
              : `${this.siteUrl}${article.featured_image}`;
            
            images.push({
              url: imageUrl,
              title: article.title,
              caption: `Featured image for ${article.title}`
            });
          }

          const newsData = {
            publicationName: process.env.SITE_NAME || 'News Portal',
            language: 'en',
            publishDate: article.published_at,
            title: article.title,
            keywords: article.meta_keywords || article.category_name
          };

          sitemap += this.generateUrlEntry(
            url,
            article.published_at,
            'hourly',
            '1.0',
            true,
            newsData,
            images
          );
        });

        sitemap += this.generateSitemapFooter();
        return sitemap;
      } catch (error) {
        logger.error('Error generating news sitemap:', error);
        throw error;
      }
    }, 600); // 10 minutes cache for news
  }

  // Generate sitemap index
  async generateSitemapIndex() {
    const cacheKey = 'sitemap:index';
    
    return await redis.cache(cacheKey, async () => {
      try {
        // Count total articles using database helper
        const totalArticles = await dbHelper.countPublishedArticles();
        const articlesPerSitemap = 1000;
        const numArticleSitemaps = Math.ceil(totalArticles / articlesPerSitemap);

        let sitemapIndex = this.generateSitemapIndexHeader();

        // Add main sitemap
        sitemapIndex += `  <sitemap>
    <loc>${this.siteUrl}/sitemap-main.xml</loc>
    <lastmod>${this.formatSitemapDate(new Date())}</lastmod>
  </sitemap>`;

        // Add news sitemap
        sitemapIndex += `  <sitemap>
    <loc>${this.siteUrl}/sitemap-news.xml</loc>
    <lastmod>${this.formatSitemapDate(new Date())}</lastmod>
  </sitemap>`;

        // Add article sitemaps
        for (let i = 1; i <= numArticleSitemaps; i++) {
          sitemapIndex += `  <sitemap>
    <loc>${this.siteUrl}/sitemap-articles-${i}.xml</loc>
    <lastmod>${this.formatSitemapDate(new Date())}</lastmod>
  </sitemap>`;
        }

        sitemapIndex += this.generateSitemapIndexFooter();
        return sitemapIndex;
      } catch (error) {
        logger.error('Error generating sitemap index:', error);
        throw error;
      }
    }, this.cache_ttl);
  }

  // Save sitemap to file
  async saveSitemapToFile(filename, content) {
    try {
      const filepath = path.join(this.sitemapPath, filename);
      await fs.writeFile(filepath, content, 'utf8');
      logger.info(`Sitemap saved: ${filename}`);
      return true;
    } catch (error) {
      logger.error(`Error saving sitemap ${filename}:`, error);
      return false;
    }
  }

  // Generate all sitemaps with better error handling
  async generateAllSitemaps() {
    try {
      logger.info('Starting sitemap generation...');
      
      // Test database connection first
      const dbConnected = await dbHelper.testConnection();
      if (!dbConnected) {
        throw new Error('Database connection test failed');
      }

      // Generate main sitemap
      const mainSitemap = await this.generateMainSitemap();
      await this.saveSitemapToFile('sitemap-main.xml', mainSitemap);

      // Generate news sitemap
      const newsSitemap = await this.generateNewsSitemap();
      await this.saveSitemapToFile('sitemap-news.xml', newsSitemap);

      // Generate article sitemaps
      const totalArticles = await dbHelper.countPublishedArticles();
      const articlesPerSitemap = 1000;
      const numArticleSitemaps = Math.ceil(totalArticles / articlesPerSitemap);

      let articleSitemapsGenerated = 0;
      for (let i = 1; i <= numArticleSitemaps; i++) {
        try {
          const articlesSitemap = await this.generateArticlesSitemap(i, articlesPerSitemap);
          if (articlesSitemap) {
            await this.saveSitemapToFile(`sitemap-articles-${i}.xml`, articlesSitemap);
            articleSitemapsGenerated++;
          }
        } catch (error) {
          logger.error(`Error generating articles sitemap ${i}:`, error);
          // Continue with next sitemap
        }
      }

      // Generate sitemap index
      const sitemapIndex = await this.generateSitemapIndex();
      await this.saveSitemapToFile('sitemap.xml', sitemapIndex);

      logger.info('Sitemap generation completed successfully');
      return {
        success: true,
        generated: {
          main: 1,
          news: 1,
          articles: articleSitemapsGenerated,
          index: 1,
          total: articleSitemapsGenerated + 3
        }
      };
    } catch (error) {
      logger.error('Error generating sitemaps:', error);
      throw error;
    }
  }

  // Clear sitemap cache
  async clearSitemapCache() {
    try {
      const patterns = [
        'sitemap:main',
        'sitemap:news',
        'sitemap:index'
      ];

      for (const pattern of patterns) {
        await redis.del(pattern);
      }

      // Clear article sitemaps cache
      for (let i = 1; i <= 100; i++) {
        await redis.del(`sitemap:articles:${i}`);
      }

      logger.info('Sitemap cache cleared');
    } catch (error) {
      logger.error('Error clearing sitemap cache:', error);
    }
  }

  // Get sitemap statistics using database helper
  async getSitemapStats() {
    try {
      const totalArticles = await dbHelper.countPublishedArticles();
      const totalCategories = await dbHelper.countActiveCategories();
      const totalTags = await dbHelper.countActiveTags();
      const recentNews = await dbHelper.countRecentNews();

      return {
        total_articles: totalArticles,
        total_categories: totalCategories,
        total_tags: totalTags,
        recent_news: recentNews,
        estimated_sitemaps: Math.ceil(totalArticles / 1000) + 3,
        last_generated: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error getting sitemap stats:', error);
      throw error;
    }
  }

  // Ping search engines about sitemap updates
  async pingSearchEngines() {
    const sitemapUrl = `${this.siteUrl}/sitemap.xml`;
    const pingUrls = [
      `http://www.google.com/webmasters/tools/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
      `http://www.bing.com/webmaster/ping.aspx?siteMap=${encodeURIComponent(sitemapUrl)}`
    ];

    const results = [];
    
    for (const pingUrl of pingUrls) {
      try {
        // Note: You might need to install node-fetch for this to work
        // For now, just simulate the ping
        results.push({
          url: pingUrl,
          success: true,
          status: 200,
          note: 'Simulated ping - install node-fetch for actual pinging'
        });
        logger.info(`Would ping search engine: ${pingUrl}`);
      } catch (error) {
        results.push({
          url: pingUrl,
          success: false,
          error: error.message
        });
        logger.error(`Failed to ping search engine: ${pingUrl}`, error);
      }
    }

    return results;
  }
}

module.exports = new SitemapService();