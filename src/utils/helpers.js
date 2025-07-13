// src/utils/helpers.js
const crypto = require('crypto');
const path = require('path');

// Generate random string
const generateRandomString = (length = 32, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
};

// Generate UUID v4
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Hash string with salt
const hashWithSalt = (text, salt = null) => {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(text, salt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt };
};

// Verify hash
const verifyHash = (text, hash, salt) => {
  const verifyHash = crypto.pbkdf2Sync(text, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
};

// Format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Get file extension
const getFileExtension = (filename) => {
  return path.extname(filename).toLowerCase();
};

// Check if file type is allowed
const isAllowedFileType = (filename, allowedTypes) => {
  const ext = getFileExtension(filename);
  return allowedTypes.includes(ext);
};

// Sanitize filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
};

// Truncate string
const truncateString = (str, length, suffix = '...') => {
  if (str.length <= length) return str;
  return str.substring(0, length - suffix.length) + suffix;
};

// Capitalize first letter
const capitalizeFirst = (str) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Convert to title case
const toTitleCase = (str) => {
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
};

// Deep clone object
const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const cloned = {};
    Object.keys(obj).forEach(key => {
      cloned[key] = deepClone(obj[key]);
    });
    return cloned;
  }
};

// Debounce function
const debounce = (func, wait, immediate = false) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func(...args);
  };
};

// Throttle function
const throttle = (func, limit) => {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// Convert camelCase to snake_case
const camelToSnake = (str) => {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
};

// Convert snake_case to camelCase
const snakeToCamel = (str) => {
  return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
};

// Format date
const formatDate = (date, format = 'YYYY-MM-DD') => {
  if (!date) return '';
  
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
};

// Get time ago
const timeAgo = (date) => {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now - past) / 1000);
  
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60
  };
  
  for (const [unit, seconds] of Object.entries(intervals)) {
    const interval = Math.floor(diffInSeconds / seconds);
    if (interval >= 1) {
      return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
    }
  }
  
  return 'just now';
};

// Validate email
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate URL
const isValidURL = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Generate slug from text
const generateSlug = (text) => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Parse boolean from string
const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  return Boolean(value);
};

// Safe JSON parse
const safeJSONParse = (str, defaultValue = null) => {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
};

// Chunk array
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// Remove duplicates from array
const removeDuplicates = (array, key = null) => {
  if (key) {
    const seen = new Set();
    return array.filter(item => {
      const value = item[key];
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }
  return [...new Set(array)];
};

// Sort array of objects by multiple keys
const sortByMultipleKeys = (array, keys) => {
  return array.sort((a, b) => {
    return keys.reduce((result, key) => {
      if (result !== 0) return result;
      
      const [field, order = 'asc'] = key.split(':');
      const aVal = a[field];
      const bVal = b[field];
      
      if (aVal < bVal) return order === 'desc' ? 1 : -1;
      if (aVal > bVal) return order === 'desc' ? -1 : 1;
      return 0;
    }, 0);
  });
};

// Escape HTML
const escapeHtml = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
};

// Strip HTML tags
const stripHtml = (html) => {
  return html.replace(/<[^>]*>/g, '');
};

// Calculate reading time
const calculateReadingTime = (text, wordsPerMinute = 200) => {
  const words = stripHtml(text).split(/\s+/).length;
  const minutes = Math.ceil(words / wordsPerMinute);
  return minutes;
};

// Get nested object value
const getNestedValue = (obj, path, defaultValue = undefined) => {
  const keys = path.split('.');
  let result = obj;
  
  for (const key of keys) {
    if (result === null || result === undefined) {
      return defaultValue;
    }
    result = result[key];
  }
  
  return result !== undefined ? result : defaultValue;
};

// Set nested object value
const setNestedValue = (obj, path, value) => {
  const keys = path.split('.');
  const lastKey = keys.pop();
  let current = obj;
  
  for (const key of keys) {
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[lastKey] = value;
  return obj;
};

module.exports = {
  generateRandomString,
  generateUUID,
  hashWithSalt,
  verifyHash,
  formatFileSize,
  getFileExtension,
  isAllowedFileType,
  sanitizeFilename,
  truncateString,
  capitalizeFirst,
  toTitleCase,
  deepClone,
  debounce,
  throttle,
  camelToSnake,
  snakeToCamel,
  formatDate,
  timeAgo,
  isValidEmail,
  isValidURL,
  generateSlug,
  parseBoolean,
  safeJSONParse,
  chunkArray,
  removeDuplicates,
  sortByMultipleKeys,
  escapeHtml,
  stripHtml,
  calculateReadingTime,
  getNestedValue,
  setNestedValue
};