// src/utils/sanitizer.js
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const xss = require('xss');

// Initialize DOMPurify with JSDOM
const window = new JSDOM('').window;
const createDOMPurify = DOMPurify(window);

class Sanitizer {
  constructor() {
    // Configure XSS options
    this.xssOptions = {
      whiteList: {
        p: ['class', 'style'],
        br: [],
        strong: [],
        b: [],
        em: [],
        i: [],
        u: [],
        s: [],
        h1: ['class'],
        h2: ['class'],
        h3: ['class'],
        h4: ['class'],
        h5: ['class'],
        h6: ['class'],
        ul: ['class'],
        ol: ['class'],
        li: ['class'],
        a: ['href', 'title', 'target'],
        img: ['src', 'alt', 'title', 'width', 'height', 'class'],
        blockquote: ['class'],
        code: ['class'],
        pre: ['class'],
        div: ['class'],
        span: ['class'],
        table: ['class'],
        thead: [],
        tbody: [],
        tr: [],
        th: ['class'],
        td: ['class']
      },
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script', 'style'],
      allowCommentTag: false,
              css: {
        whiteList: {
          'text-align': /^(left|right|center|justify)$/,
          'color': /^#[0-9a-fA-F]{6}$/,
          'background-color': /^#[0-9a-fA-F]{6}$/,
          'font-size': /^\d+px$/,
          'font-weight': /^(normal|bold|bolder|lighter|\d+)$/,
          'text-decoration': /^(none|underline|overline|line-through)$/,
          'margin': /^\d+px$/,
          'padding': /^\d+px$/,
          'border': /^\d+px\s+(solid|dashed|dotted)\s+#[0-9a-fA-F]{6}$/
        }
      }
    };
  }

  // Sanitize HTML content for articles
  sanitizeArticleContent(html) {
    if (!html) return '';

    // Use DOMPurify for comprehensive sanitization
    const cleanHtml = createDOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'a', 'img',
        'blockquote', 'code', 'pre',
        'div', 'span',
        'table', 'thead', 'tbody', 'tr', 'th', 'td'
      ],
      ALLOWED_ATTR: [
        'href', 'title', 'target', 'src', 'alt', 'width', 'height',
        'class', 'style'
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      ADD_TAGS: ['iframe'],
      ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling'],
      FORBID_TAGS: ['script', 'object', 'embed', 'base', 'meta', 'link'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      KEEP_CONTENT: true,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      RETURN_DOM_IMPORT: false,
      SANITIZE_DOM: true,
      WHOLE_DOCUMENT: false,
      IN_PLACE: false
    });

    return cleanHtml;
  }

  // Sanitize comment content
  sanitizeCommentContent(text) {
    if (!text) return '';

    // More restrictive sanitization for comments
    const cleanText = createDOMPurify.sanitize(text, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a'],
      ALLOWED_ATTR: ['href', 'title'],
      KEEP_CONTENT: true,
      STRIP_COMMENTS: true
    });

    return cleanText;
  }

  // Sanitize user input (forms, etc.)
  sanitizeUserInput(input) {
    if (!input) return '';

    // Strip all HTML tags and special characters
    return input
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[<>'"&]/g, '') // Remove dangerous characters
      .trim();
  }

  // Sanitize search queries
  sanitizeSearchQuery(query) {
    if (!query) return '';

    return query
      .replace(/[<>'"&\\/]/g, '') // Remove dangerous characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .substring(0, 200); // Limit length
  }

  // Sanitize filename
  sanitizeFilename(filename) {
    if (!filename) return '';

    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .toLowerCase();
  }

  // Sanitize URL
  sanitizeUrl(url) {
    if (!url) return '';

    // Basic URL validation and cleaning
    try {
      const urlObj = new URL(url);
      
      // Only allow http and https protocols
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return '';
      }

      return urlObj.toString();
    } catch (error) {
      return '';
    }
  }

  // Remove script tags and event handlers
  removeScripts(html) {
    if (!html) return '';

    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }

  // Escape HTML entities
  escapeHtml(text) {
    if (!text) return '';

    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;'
    };

    return text.replace(/[&<>"'\/]/g, (char) => entityMap[char]);
  }

  // Unescape HTML entities
  unescapeHtml(text) {
    if (!text) return '';

    const entityMap = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#x27;': "'",
      '&#x2F;': '/'
    };

    return text.replace(/&(amp|lt|gt|quot|#x27|#x2F);/g, (entity) => entityMap[entity]);
  }

  // Sanitize SQL input (basic protection)
  sanitizeSqlInput(input) {
    if (!input) return '';

    // Remove common SQL injection patterns
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
      /(\b(OR|AND)\b\s*\d+\s*=\s*\d+)/gi,
      /(\b(OR|AND)\b\s*\'\w+\'\s*=\s*\'\w+\')/gi,
      /(--|#|\/\*|\*\/)/g,
      /(\bUNION\b.*\bSELECT\b)/gi
    ];

    let sanitized = input;
    sqlPatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    return sanitized.trim();
  }

  // Sanitize and validate email
  sanitizeEmail(email) {
    if (!email) return '';

    const sanitized = email
      .toLowerCase()
      .trim()
      .replace(/[^a-zA-Z0-9@._-]/g, '');

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(sanitized) ? sanitized : '';
  }

  // Sanitize phone number
  sanitizePhoneNumber(phone) {
    if (!phone) return '';

    // Remove all non-digit characters except + at the beginning
    return phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  }

  // Comprehensive content sanitization
  sanitizeContent(content, type = 'article') {
    if (!content) return '';

    switch (type) {
      case 'article':
        return this.sanitizeArticleContent(content);
      case 'comment':
        return this.sanitizeCommentContent(content);
      case 'search':
        return this.sanitizeSearchQuery(content);
      case 'user_input':
        return this.sanitizeUserInput(content);
      default:
        return this.sanitizeUserInput(content);
    }
  }
}

module.exports = new Sanitizer();
