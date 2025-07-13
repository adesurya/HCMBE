// src/utils/validator.js
const validator = require('validator');

class Validator {
  constructor() {
    this.errors = [];
  }

  // Reset errors
  reset() {
    this.errors = [];
    return this;
  }

  // Add error
  addError(field, message) {
    this.errors.push({ field, message });
    return this;
  }

  // Get all errors
  getErrors() {
    return this.errors;
  }

  // Check if validation failed
  hasErrors() {
    return this.errors.length > 0;
  }

  // Validate required field
  required(value, field, message = null) {
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      this.addError(field, message || `${field} is required`);
    }
    return this;
  }

  // Validate email
  email(value, field, message = null) {
    if (value && !validator.isEmail(value)) {
      this.addError(field, message || `${field} must be a valid email address`);
    }
    return this;
  }

  // Validate string length
  length(value, field, min = 0, max = null, message = null) {
    if (value) {
      const length = value.length;
      if (length < min) {
        this.addError(field, message || `${field} must be at least ${min} characters long`);
      }
      if (max && length > max) {
        this.addError(field, message || `${field} must not exceed ${max} characters`);
      }
    }
    return this;
  }

  // Validate number range
  range(value, field, min = null, max = null, message = null) {
    if (value !== null && value !== undefined) {
      const num = Number(value);
      if (isNaN(num)) {
        this.addError(field, message || `${field} must be a valid number`);
      } else {
        if (min !== null && num < min) {
          this.addError(field, message || `${field} must be at least ${min}`);
        }
        if (max !== null && num > max) {
          this.addError(field, message || `${field} must not exceed ${max}`);
        }
      }
    }
    return this;
  }

  // Validate URL
  url(value, field, message = null) {
    if (value && !validator.isURL(value, { require_protocol: true })) {
      this.addError(field, message || `${field} must be a valid URL`);
    }
    return this;
  }

  // Validate password strength
  password(value, field, message = null) {
    if (value) {
      const minLength = 8;
      const hasUpperCase = /[A-Z]/.test(value);
      const hasLowerCase = /[a-z]/.test(value);
      const hasNumbers = /\d/.test(value);
      const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(value);

      if (value.length < minLength) {
        this.addError(field, message || `${field} must be at least ${minLength} characters long`);
      }
      if (!hasUpperCase) {
        this.addError(field, message || `${field} must contain at least one uppercase letter`);
      }
      if (!hasLowerCase) {
        this.addError(field, message || `${field} must contain at least one lowercase letter`);
      }
      if (!hasNumbers) {
        this.addError(field, message || `${field} must contain at least one number`);
      }
      if (!hasSpecialChar) {
        this.addError(field, message || `${field} must contain at least one special character`);
      }
    }
    return this;
  }

  // Validate username
  username(value, field, message = null) {
    if (value) {
      const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
      if (!usernameRegex.test(value)) {
        this.addError(field, message || `${field} must be 3-50 characters long and contain only letters, numbers, and underscores`);
      }
    }
    return this;
  }

  // Validate phone number
  phone(value, field, message = null) {
    if (value && !validator.isMobilePhone(value, 'any')) {
      this.addError(field, message || `${field} must be a valid phone number`);
    }
    return this;
  }

  // Validate date
  date(value, field, message = null) {
    if (value && !validator.isISO8601(value)) {
      this.addError(field, message || `${field} must be a valid date`);
    }
    return this;
  }

  // Validate slug
  slug(value, field, message = null) {
    if (value) {
      const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      if (!slugRegex.test(value)) {
        this.addError(field, message || `${field} must be a valid slug (lowercase letters, numbers, and hyphens only)`);
      }
    }
    return this;
  }

  // Validate hex color
  hexColor(value, field, message = null) {
    if (value && !validator.isHexColor(value)) {
      this.addError(field, message || `${field} must be a valid hex color`);
    }
    return this;
  }

  // Validate enum/options
  enum(value, field, options, message = null) {
    if (value && !options.includes(value)) {
      this.addError(field, message || `${field} must be one of: ${options.join(', ')}`);
    }
    return this;
  }

  // Validate boolean
  boolean(value, field, message = null) {
    if (value !== undefined && typeof value !== 'boolean') {
      this.addError(field, message || `${field} must be a boolean value`);
    }
    return this;
  }

  // Validate array
  array(value, field, message = null) {
    if (value && !Array.isArray(value)) {
      this.addError(field, message || `${field} must be an array`);
    }
    return this;
  }

  // Validate file type
  fileType(file, field, allowedTypes, message = null) {
    if (file && file.mimetype) {
      if (!allowedTypes.includes(file.mimetype)) {
        this.addError(field, message || `${field} must be one of the following types: ${allowedTypes.join(', ')}`);
      }
    }
    return this;
  }

  // Validate file size
  fileSize(file, field, maxSize, message = null) {
    if (file && file.size) {
      if (file.size > maxSize) {
        const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
        this.addError(field, message || `${field} size must not exceed ${maxSizeMB}MB`);
      }
    }
    return this;
  }

  // Custom validation
  custom(value, field, validatorFn, message = null) {
    if (!validatorFn(value)) {
      this.addError(field, message || `${field} is invalid`);
    }
    return this;
  }

  // Validate article data
  validateArticle(data) {
    this.reset();

    this.required(data.title, 'title')
        .length(data.title, 'title', 10, 255);

    this.required(data.content, 'content')
        .length(data.content, 'content', 50);

    if (data.excerpt) {
      this.length(data.excerpt, 'excerpt', 0, 500);
    }

    if (data.category_id) {
      this.range(data.category_id, 'category_id', 1);
    }

    if (data.meta_title) {
      this.length(data.meta_title, 'meta_title', 0, 255);
    }

    if (data.meta_description) {
      this.length(data.meta_description, 'meta_description', 0, 160);
    }

    if (data.status) {
      this.enum(data.status, 'status', ['draft', 'ready_to_post', 'published', 'archived']);
    }

    if (data.scheduled_at) {
      this.date(data.scheduled_at, 'scheduled_at');
    }

    return this;
  }

  // Validate user data
  validateUser(data, isUpdate = false) {
    this.reset();

    if (!isUpdate || data.username !== undefined) {
      this.required(data.username, 'username')
          .username(data.username, 'username');
    }

    if (!isUpdate || data.email !== undefined) {
      this.required(data.email, 'email')
          .email(data.email, 'email');
    }

    if (!isUpdate || data.password !== undefined) {
      if (!isUpdate) {
        this.required(data.password, 'password');
      }
      if (data.password) {
        this.password(data.password, 'password');
      }
    }

    if (!isUpdate || data.first_name !== undefined) {
      this.required(data.first_name, 'first_name')
          .length(data.first_name, 'first_name', 2, 100);
    }

    if (!isUpdate || data.last_name !== undefined) {
      this.required(data.last_name, 'last_name')
          .length(data.last_name, 'last_name', 2, 100);
    }

    if (data.role) {
      this.enum(data.role, 'role', ['admin', 'editor', 'journalist', 'user']);
    }

    if (data.bio) {
      this.length(data.bio, 'bio', 0, 500);
    }

    return this;
  }

  // Validate category data
  validateCategory(data) {
    this.reset();

    this.required(data.name, 'name')
        .length(data.name, 'name', 2, 100);

    if (data.description) {
      this.length(data.description, 'description', 0, 500);
    }

    if (data.parent_id) {
      this.range(data.parent_id, 'parent_id', 1);
    }

    if (data.meta_title) {
      this.length(data.meta_title, 'meta_title', 0, 255);
    }

    if (data.meta_description) {
      this.length(data.meta_description, 'meta_description', 0, 255);
    }

    return this;
  }

  // Validate tag data
  validateTag(data) {
    this.reset();

    this.required(data.name, 'name')
        .length(data.name, 'name', 2, 100);

    if (data.description) {
      this.length(data.description, 'description', 0, 500);
    }

    if (data.color) {
      this.hexColor(data.color, 'color');
    }

    return this;
  }

  // Validate comment data
  validateComment(data) {
    this.reset();

    this.required(data.content, 'content')
        .length(data.content, 'content', 10, 1000);

    this.required(data.article_id, 'article_id')
        .range(data.article_id, 'article_id', 1);

    if (data.parent_id) {
      this.range(data.parent_id, 'parent_id', 1);
    }

    // For guest comments
    if (!data.user_id) {
      this.required(data.author_name, 'author_name')
          .length(data.author_name, 'author_name', 2, 100);

      this.required(data.author_email, 'author_email')
          .email(data.author_email, 'author_email');
    }

    return this;
  }
}

module.exports = Validator;