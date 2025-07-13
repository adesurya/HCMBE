// src/config/redis.js - Fixed version with better error handling
const redis = require('redis');
const logger = require('../utils/logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isEnabled = process.env.REDIS_ENABLED !== 'false'; // Default to true unless explicitly disabled
    
    if (this.isEnabled) {
      this.connect();
    } else {
      logger.info('Redis is disabled, using memory fallback');
    }
  }

  async connect() {
    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error:', err);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        logger.info('Redis client disconnected');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('Redis client reconnecting');
      });

      await this.client.connect();
    } catch (error) {
      logger.error('Redis connection error:', error);
      this.isConnected = false;
      this.isEnabled = false; // Disable Redis if connection fails
      logger.warn('Redis disabled due to connection failure, using memory fallback');
    }
  }

  async get(key) {
    if (!this.isConnected || !this.isEnabled) return null;
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  }

  async set(key, value, expireInSeconds = 3600) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      const serializedValue = JSON.stringify(value);
      if (expireInSeconds) {
        await this.client.setEx(key, expireInSeconds, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }
      return true;
    } catch (error) {
      logger.error('Redis set error:', error);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis delete error:', error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis exists error:', error);
      return false;
    }
  }

  async incr(key, expireInSeconds = 3600) {
    if (!this.isConnected || !this.isEnabled) return 0;
    try {
      const value = await this.client.incr(key);
      if (value === 1 && expireInSeconds) {
        await this.client.expire(key, expireInSeconds);
      }
      return value;
    } catch (error) {
      logger.error('Redis incr error:', error);
      return 0;
    }
  }

  // Cache wrapper for functions with memory fallback
  async cache(key, fetchFunction, expireInSeconds = 3600) {
    try {
      // If Redis is not available, just execute the function
      if (!this.isConnected || !this.isEnabled) {
        logger.debug(`Redis not available, executing function directly for key: ${key}`);
        return await fetchFunction();
      }

      // Try to get from cache first
      const cached = await this.get(key);
      if (cached !== null) {
        logger.debug(`Cache hit for key: ${key}`);
        return cached;
      }

      logger.debug(`Cache miss for key: ${key}, executing function`);
      
      // If not in cache, execute function
      const result = await fetchFunction();
      
      // Store in cache (don't wait for it)
      this.set(key, result, expireInSeconds).catch(error => {
        logger.error(`Failed to cache result for key ${key}:`, error);
      });
      
      return result;
    } catch (error) {
      logger.error('Redis cache error:', error);
      // If cache fails, just return the function result
      return await fetchFunction();
    }
  }

  // Session storage (with fallback)
  async setSession(sessionId, data, expireInSeconds = 86400) {
    return await this.set(`session:${sessionId}`, data, expireInSeconds);
  }

  async getSession(sessionId) {
    return await this.get(`session:${sessionId}`);
  }

  async deleteSession(sessionId) {
    return await this.del(`session:${sessionId}`);
  }

  // Rate limiting (with fallback)
  async isRateLimited(key, limit, windowInSeconds) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      const current = await this.incr(key, windowInSeconds);
      return current > limit;
    } catch (error) {
      logger.error('Redis rate limit error:', error);
      return false;
    }
  }

  // Additional helper methods
  async hget(key, field) {
    if (!this.isConnected || !this.isEnabled) return null;
    try {
      const value = await this.client.hGet(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis hget error:', error);
      return null;
    }
  }

  async hset(key, field, value, expireInSeconds = 3600) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      const serializedValue = JSON.stringify(value);
      await this.client.hSet(key, field, serializedValue);
      if (expireInSeconds) {
        await this.client.expire(key, expireInSeconds);
      }
      return true;
    } catch (error) {
      logger.error('Redis hset error:', error);
      return false;
    }
  }

  async hgetall(key) {
    if (!this.isConnected || !this.isEnabled) return {};
    try {
      const hash = await this.client.hGetAll(key);
      const result = {};
      for (const [field, value] of Object.entries(hash)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value;
        }
      }
      return result;
    } catch (error) {
      logger.error('Redis hgetall error:', error);
      return {};
    }
  }

  async sadd(key, ...members) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      await this.client.sAdd(key, members);
      return true;
    } catch (error) {
      logger.error('Redis sadd error:', error);
      return false;
    }
  }

  async smembers(key) {
    if (!this.isConnected || !this.isEnabled) return [];
    try {
      return await this.client.sMembers(key);
    } catch (error) {
      logger.error('Redis smembers error:', error);
      return [];
    }
  }

  async zadd(key, score, member) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      await this.client.zAdd(key, { score, value: member });
      return true;
    } catch (error) {
      logger.error('Redis zadd error:', error);
      return false;
    }
  }

  async zrevrange(key, start = 0, stop = -1, withScores = false) {
    if (!this.isConnected || !this.isEnabled) return [];
    try {
      if (withScores) {
        return await this.client.zRevRangeWithScores(key, start, stop);
      }
      return await this.client.zRevRange(key, start, stop);
    } catch (error) {
      logger.error('Redis zrevrange error:', error);
      return [];
    }
  }

  async flushall() {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      await this.client.flushAll();
      return true;
    } catch (error) {
      logger.error('Redis flushall error:', error);
      return false;
    }
  }

  async expire(key, seconds) {
    if (!this.isConnected || !this.isEnabled) return false;
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error('Redis expire error:', error);
      return false;
    }
  }

  async ttl(key) {
    if (!this.isConnected || !this.isEnabled) return -1;
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis ttl error:', error);
      return -1;
    }
  }

  // Get Redis status
  getStatus() {
    return {
      enabled: this.isEnabled,
      connected: this.isConnected,
      client: !!this.client
    };
  }

  async close() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis client closed');
    }
  }
}

module.exports = new RedisClient();