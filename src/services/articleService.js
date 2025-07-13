// src/services/articleService.js
const Article = require('../models/Article');
const redis = require('../config/redis');
const logger = require('../utils/logger');

class ArticleService {
  constructor() {
    this.cache_ttl = 600; // 10 minutes cache
  }

  // Get trending articles
  async getTrendingArticles(limit = 10, hours = 24) {
    const cacheKey = `trending:${limit}:${hours}`;
    
    return await redis.cache(cacheKey, async () => {
      const [rows] = await db.execute(
        `SELECT a.*, u.username as author_name, c.name as category_name,
                COUNT(an.id) as recent_views
         FROM articles a
         LEFT JOIN users u ON a.author_id = u.id
         LEFT JOIN categories c ON a.category_id = c.id
         LEFT JOIN analytics an ON a.id = an.article_id 
           AND an.event_type = 'view' 
           AND an.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
         WHERE a.status = 'published'
           AND a.published_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY a.id
         ORDER BY recent_views DESC, a.published_at DESC
         LIMIT ?`,
        [hours, limit]
      );

      return rows.map(row => {
        const article = new Article(row);
        article.author = { username: row.author_name };
        article.category = { name: row.category_name };
        article.recent_views = row.recent_views;
        return article;
      });
    }, this.cache_ttl);
  }

  // Get recommended articles for user
  async getRecommendedArticles(userId, limit = 10) {
    if (!userId) {
      return await this.getPopularArticles(limit);
    }

    const cacheKey = `recommendations:${userId}:${limit}`;
    
    return await redis.cache(cacheKey, async () => {
      // Get user's reading history and preferences
      const [userHistory] = await db.execute(
        `SELECT DISTINCT a.category_id, COUNT(*) as read_count
         FROM analytics an
         JOIN articles a ON an.article_id = a.id
         WHERE an.ip_address = (
           SELECT ip_address FROM analytics 
           WHERE article_id IN (
             SELECT id FROM articles WHERE author_id = ?
           ) LIMIT 1
         ) AND an.event_type = 'view'
         GROUP BY a.category_id
         ORDER BY read_count DESC
         LIMIT 3`,
        [userId]
      );

      if (userHistory.length === 0) {
        return await this.getPopularArticles(limit);
      }

      const categoryIds = userHistory.map(h => h.category_id);
      const placeholders = categoryIds.map(() => '?').join(',');

      const [rows] = await db.execute(
        `SELECT a.*, u.username as author_name, c.name as category_name
         FROM articles a
         LEFT JOIN users u ON a.author_id = u.id
         LEFT JOIN categories c ON a.category_id = c.id
         WHERE a.status = 'published'
           AND a.category_id IN (${placeholders})
           AND a.published_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY a.views DESC, a.published_at DESC
         LIMIT ?`,
        [...categoryIds, limit]
      );

      return rows.map(row => {
        const article = new Article(row);
        article.author = { username: row.author_name };
        article.category = { name: row.category_name };
        return article;
      });
    }, this.cache_ttl);
  }

  // Get popular articles
  async getPopularArticles(limit = 10, days = 7) {
    return await Article.getPopular(limit, days);
  }

  // Search articles with advanced features
  async searchArticles(query, options = {}) {
    const {
      page = 1,
      limit = 10,
      category_id = null,
      author_id = null,
      date_from = null,
      date_to = null,
      sort_by = 'relevance',
      sort_order = 'DESC'
    } = options;

    // Use full-text search
    const result = await Article.search(query, {
      page,
      limit,
      category_id,
      author_id,
      date_from,
      date_to,
      sort_by,
      sort_order
    });

    // Track search query
    try {
      await db.execute(
        'INSERT INTO search_queries (query, results_count, ip_address, user_id) VALUES (?, ?, ?, ?)',
        [query, result.pagination.total, options.ip_address, options.user_id]
      );
    } catch (error) {
      logger.error('Error tracking search query:', error);
    }

    return result;
  }

  // Get article reading time estimate
  getReadingTime(content) {
    if (!content) return 0;
    
    // Remove HTML tags and count words
    const plainText = content.replace(/<[^>]*>/g, '');
    const wordCount = plainText.split(/\s+/).length;
    
    // Average reading speed is 200-250 words per minute
    const wordsPerMinute = 225;
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    
    return minutes;
  }

  // Generate article excerpt
  generateExcerpt(content, maxLength = 200) {
    if (!content) return '';
    
    // Remove HTML tags
    const plainText = content.replace(/<[^>]*>/g, '');
    
    if (plainText.length <= maxLength) {
      return plainText;
    }
    
    // Find the last complete sentence within the limit
    const truncated = plainText.substring(0, maxLength);
    const lastSentence = truncated.lastIndexOf('.');
    
    if (lastSentence > maxLength * 0.7) {
      return truncated.substring(0, lastSentence + 1);
    }
    
    // If no good sentence break, find last word
    const lastSpace = truncated.lastIndexOf(' ');
    return truncated.substring(0, lastSpace) + '...';
  }

  // Get related articles
  async getRelatedArticles(articleId, limit = 5) {
    const article = await Article.findById(articleId);
    if (!article) {
      return [];
    }

    return await article.getRelatedArticles(limit);
  }

  // Schedule article publication
  async scheduleArticle(articleId, publishAt) {
    const article = await Article.findById(articleId);
    if (!article) {
      throw new Error('Article not found');
    }

    await article.update({
      scheduled_at: publishAt,
      status: 'draft'
    });

    // You could implement a job queue here to actually publish the article
    // For now, this is just setting the scheduled_at time
    
    return article;
  }

  // Bulk operations
  async bulkUpdateStatus(articleIds, status, userId) {
    const results = { processed: 0, failed: 0 };

    for (const id of articleIds) {
      try {
        const article = await Article.findById(id);
        if (!article) {
          results.failed++;
          continue;
        }

        // Check permissions
        if (!article.canEdit(userId, 'admin')) {
          results.failed++;
          continue;
        }

        await article.update({ status });
        results.processed++;
      } catch (error) {
        logger.error(`Error updating article ${id}:`, error);
        results.failed++;
      }
    }

    return results;
  }

  // Get article statistics
  async getArticleStats(articleId) {
    const cacheKey = `article_stats:${articleId}`;
    
    return await redis.cache(cacheKey, async () => {
      const [stats] = await db.execute(
        `SELECT 
           a.views,
           a.likes,
           COUNT(DISTINCT c.id) as comment_count,
           COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'approved') as approved_comments,
           AVG(an.view_duration) as avg_reading_time
         FROM articles a
         LEFT JOIN comments c ON a.id = c.article_id
         LEFT JOIN analytics an ON a.id = an.article_id AND an.event_type = 'view'
         WHERE a.id = ?
         GROUP BY a.id`,
        [articleId]
      );

      return stats[0] || {
        views: 0,
        likes: 0,
        comment_count: 0,
        approved_comments: 0,
        avg_reading_time: 0
      };
    }, 300); // 5 minute cache
  }

  // Get content analysis
  analyzeContent(content) {
    if (!content) {
      return {
        word_count: 0,
        character_count: 0,
        reading_time: 0,
        readability_score: 0
      };
    }

    const plainText = content.replace(/<[^>]*>/g, '');
    const words = plainText.split(/\s+/).filter(word => word.length > 0);
    const sentences = plainText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    const wordCount = words.length;
    const characterCount = plainText.length;
    const readingTime = this.getReadingTime(content);
    
    // Simple readability score (Flesch Reading Ease approximation)
    const avgWordsPerSentence = sentences.length > 0 ? wordCount / sentences.length : 0;
    const avgSyllablesPerWord = this.estimateAverageSyllables(words);
    const readabilityScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);

    return {
      word_count: wordCount,
      character_count: characterCount,
      reading_time: readingTime,
      readability_score: Math.max(0, Math.min(100, readabilityScore)),
      sentences_count: sentences.length,
      avg_words_per_sentence: Math.round(avgWordsPerSentence * 10) / 10
    };
  }

  // Estimate average syllables per word (simple heuristic)
  estimateAverageSyllables(words) {
    if (words.length === 0) return 1;
    
    const totalSyllables = words.reduce((sum, word) => {
      return sum + this.countSyllables(word);
    }, 0);
    
    return totalSyllables / words.length;
  }

  // Count syllables in a word (simple heuristic)
  countSyllables(word) {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    
    const vowels = 'aeiouy';
    let syllableCount = 0;
    let previousWasVowel = false;
    
    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i]);
      if (isVowel && !previousWasVowel) {
        syllableCount++;
      }
      previousWasVowel = isVowel;
    }
    
    // Handle silent 'e'
    if (word.endsWith('e')) {
      syllableCount--;
    }
    
    return Math.max(1, syllableCount);
  }

  // Generate SEO recommendations
  generateSEORecommendations(article) {
    const recommendations = [];
    const content = article.content || '';
    const title = article.title || '';
    const excerpt = article.excerpt || '';
    const metaDescription = article.meta_description || '';

    // Title recommendations
    if (title.length < 30) {
      recommendations.push({
        type: 'title',
        severity: 'warning',
        message: 'Title is quite short. Consider making it more descriptive (30-60 characters).'
      });
    } else if (title.length > 60) {
      recommendations.push({
        type: 'title',
        severity: 'error',
        message: 'Title is too long. Keep it under 60 characters for better SEO.'
      });
    }

    // Meta description recommendations
    if (!metaDescription) {
      recommendations.push({
        type: 'meta_description',
        severity: 'error',
        message: 'Meta description is missing. Add one for better search engine visibility.'
      });
    } else if (metaDescription.length < 120) {
      recommendations.push({
        type: 'meta_description',
        severity: 'warning',
        message: 'Meta description is short. Aim for 120-160 characters.'
      });
    } else if (metaDescription.length > 160) {
      recommendations.push({
        type: 'meta_description',
        severity: 'error',
        message: 'Meta description is too long. Keep it under 160 characters.'
      });
    }

    // Content length recommendations
    const contentAnalysis = this.analyzeContent(content);
    if (contentAnalysis.word_count < 300) {
      recommendations.push({
        type: 'content',
        severity: 'warning',
        message: 'Article is quite short. Consider adding more content (aim for 300+ words).'
      });
    }

    // Reading time recommendations
    if (contentAnalysis.reading_time > 10) {
      recommendations.push({
        type: 'content',
        severity: 'info',
        message: 'This is a long article. Consider breaking it into sections or multiple parts.'
      });
    }

    // Featured image recommendation
    if (!article.featured_image) {
      recommendations.push({
        type: 'featured_image',
        severity: 'warning',
        message: 'No featured image set. Adding one improves social sharing and engagement.'
      });
    }

    return recommendations;
  }
}

module.exports = new ArticleService();