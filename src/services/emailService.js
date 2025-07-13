// src/services/emailService.js - Fixed version with better error handling
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@localhost';
    this.fromName = process.env.FROM_NAME || 'News Portal';
    this.siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    this.siteName = process.env.SITE_NAME || 'News Portal';
    this.isEnabled = process.env.EMAIL_ENABLED === 'true';
    
    // Only create transporter if email is enabled and SMTP settings are provided
    if (this.isEnabled && this.hasRequiredSmtpConfig()) {
      this.createTransporter();
    } else {
      logger.warn('Email service disabled or SMTP configuration missing');
      this.transporter = null;
    }
  }

  // Check if required SMTP configuration exists
  hasRequiredSmtpConfig() {
    return !!(
      process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    );
  }

  // Create email transporter
  createTransporter() {
    try {
      this.transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000, // 10 seconds
        socketTimeout: 30000, // 30 seconds
        // Add TLS options for better compatibility
        tls: {
          rejectUnauthorized: false // Only for development/testing
        }
      });

      // Only verify connection if transporter is created successfully
      this.verifyConnection();
    } catch (error) {
      logger.error('Failed to create email transporter:', error);
      this.transporter = null;
    }
  }

  // Verify SMTP connection with better error handling
  async verifyConnection() {
    if (!this.transporter) {
      logger.warn('Email transporter not available for verification');
      return false;
    }

    try {
      await this.transporter.verify();
      logger.info('✅ Email service connected successfully');
      return true;
    } catch (error) {
      logger.error('❌ Email service connection failed:', {
        message: error.message,
        code: error.code,
        command: error.command
      });
      
      // Provide helpful error messages
      this.logConnectionHelp(error);
      return false;
    }
  }

  // Log helpful connection error messages
  logConnectionHelp(error) {
    const helpMessages = {
      'ESOCKET': 'Cannot connect to SMTP server. Check SMTP_HOST and SMTP_PORT.',
      'ECONNREFUSED': 'Connection refused. SMTP server may be down or port blocked.',
      'ENOTFOUND': 'SMTP host not found. Check SMTP_HOST configuration.',
      'EAUTH': 'Authentication failed. Check SMTP_USER and SMTP_PASS.',
      'ETIMEDOUT': 'Connection timeout. SMTP server may be slow or unreachable.'
    };

    const helpMessage = helpMessages[error.code] || 'Unknown SMTP error occurred.';
    logger.warn(`Email Connection Help: ${helpMessage}`);
    
    // Log current configuration (without sensitive data)
    logger.info('Current SMTP Configuration:', {
      host: process.env.SMTP_HOST || 'not set',
      port: process.env.SMTP_PORT || 'not set',
      user: process.env.SMTP_USER ? '***configured***' : 'not set',
      pass: process.env.SMTP_PASS ? '***configured***' : 'not set',
      enabled: this.isEnabled
    });
  }

  // Load email template with better error handling
  async loadTemplate(templateName, variables = {}) {
    try {
      const templatePath = path.join(__dirname, '../templates/emails', `${templateName}.html`);
      let template = await fs.readFile(templatePath, 'utf8');

      // Replace variables in template
      Object.keys(variables).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        template = template.replace(regex, variables[key] || '');
      });

      // Replace default variables
      template = template.replace(/{{SITE_NAME}}/g, this.siteName);
      template = template.replace(/{{SITE_URL}}/g, this.siteUrl);
      template = template.replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear());

      return template;
    } catch (error) {
      logger.warn(`Email template ${templateName} not found, using default template`);
      return this.getDefaultTemplate(variables);
    }
  }

  // Get default template if file template fails
  getDefaultTemplate(variables = {}) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${variables.subject || 'Notification'}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #3498db; padding-bottom: 20px; }
          .header h1 { color: #2c3e50; margin: 0; font-size: 28px; }
          .content { margin-bottom: 30px; }
          .button { display: inline-block; padding: 12px 24px; background: #3498db; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; font-weight: bold; }
          .footer { text-align: center; color: #666; font-size: 14px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; }
          .footer a { color: #3498db; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${this.siteName}</h1>
          </div>
          <div class="content">
            ${variables.content || 'Thank you for using our service.'}
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${this.siteName}. All rights reserved.</p>
            <p>
              <a href="${this.siteUrl}">Visit our website</a> | 
              <a href="${this.siteUrl}/unsubscribe">Unsubscribe</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Send email with fallback handling
  async sendEmail(to, subject, html, text = null) {
    // If email service is disabled or not configured, log and return
    if (!this.isEnabled || !this.transporter) {
      logger.info(`Email would be sent to ${to}: ${subject} (Email service disabled)`);
      return { messageId: 'disabled', info: 'Email service disabled' };
    }

    try {
      const mailOptions = {
        from: `${this.fromName} <${this.fromEmail}>`,
        to,
        subject,
        html,
        text: text || this.htmlToText(html)
      };

      const result = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Email sent successfully to ${to}: ${subject}`);
      return result;
    } catch (error) {
      logger.error(`❌ Failed to send email to ${to}:`, {
        subject,
        error: error.message,
        code: error.code
      });

      // For development, we don't want to crash the app
      if (process.env.NODE_ENV === 'development') {
        logger.warn('Email failed in development mode - continuing execution');
        return { messageId: 'failed', error: error.message };
      }

      throw error;
    }
  }

  // Convert HTML to plain text (basic)
  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Safe email sending wrapper
  async safeEmailSend(emailFunction, ...args) {
    try {
      return await emailFunction.apply(this, args);
    } catch (error) {
      logger.error('Email sending failed:', error);
      return false;
    }
  }

  // Send verification email
  async sendVerificationEmail(email, token) {
    const verificationUrl = `${this.siteUrl}/verify-email/${token}`;
    
    const html = await this.loadTemplate('verification', {
      verification_url: verificationUrl,
      subject: 'Verify Your Email Address',
      content: `
        <h2>Welcome to ${this.siteName}!</h2>
        <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>
        <a href="${verificationUrl}" class="button">Verify Email Address</a>
        <p>If the button doesn't work, you can also copy and paste this link into your browser:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>This link will expire in 24 hours.</p>
      `
    });

    return await this.sendEmail(
      email,
      'Verify Your Email Address',
      html
    );
  }

  // Send password reset email
  async sendPasswordResetEmail(email, token) {
    const resetUrl = `${this.siteUrl}/reset-password/${token}`;
    
    const html = await this.loadTemplate('password-reset', {
      reset_url: resetUrl,
      subject: 'Reset Your Password',
      content: `
        <h2>Password Reset Request</h2>
        <p>We received a request to reset your password. Click the button below to reset it:</p>
        <a href="${resetUrl}" class="button">Reset Password</a>
        <p>If the button doesn't work, you can also copy and paste this link into your browser:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>This link will expire in 10 minutes.</p>
        <p>If you didn't request a password reset, please ignore this email.</p>
      `
    });

    return await this.sendEmail(
      email,
      'Reset Your Password',
      html
    );
  }

  // Send welcome email
  async sendWelcomeEmail(user) {
    const html = await this.loadTemplate('welcome', {
      user_name: user.first_name || user.username,
      dashboard_url: `${this.siteUrl}/dashboard`,
      subject: `Welcome to ${this.siteName}!`,
      content: `
        <h2>Welcome to ${this.siteName}, ${user.first_name || user.username}!</h2>
        <p>Your account has been successfully created. You can now start exploring our platform.</p>
        <a href="${this.siteUrl}/dashboard" class="button">Go to Dashboard</a>
        <p>If you have any questions, feel free to contact our support team.</p>
      `
    });

    return await this.sendEmail(
      user.email,
      `Welcome to ${this.siteName}!`,
      html
    );
  }

  // Send article approval notification to editors
  async sendApprovalNotification(article) {
    try {
      // Get all editors and admins
      const db = require('../config/database');
      const [editors] = await db.execute(
        'SELECT email, first_name, username FROM users WHERE role IN ("admin", "editor") AND is_active = true AND email_verified = true'
      );

      const approvalUrl = `${this.siteUrl}/admin/articles/${article.id}`;
      
      for (const editor of editors) {
        const html = await this.loadTemplate('approval-notification', {
          editor_name: editor.first_name || editor.username,
          article_title: article.title,
          article_author: article.author?.username || 'Unknown',
          approval_url: approvalUrl,
          subject: 'Article Pending Approval',
          content: `
            <h2>Article Pending Approval</h2>
            <p>Hello ${editor.first_name || editor.username},</p>
            <p>A new article is waiting for your approval:</p>
            <p><strong>Title:</strong> ${article.title}</p>
            <p><strong>Author:</strong> ${article.author?.username || 'Unknown'}</p>
            <a href="${approvalUrl}" class="button">Review Article</a>
          `
        });

        await this.safeEmailSend(this.sendEmail, editor.email, 'Article Pending Approval', html);
      }
    } catch (error) {
      logger.error('Failed to send approval notifications:', error);
    }
  }

  // Send approval confirmation to author
  async sendApprovalConfirmation(email, article) {
    const articleUrl = `${this.siteUrl}/articles/${article.slug}`;
    
    const html = await this.loadTemplate('approval-confirmation', {
      article_title: article.title,
      article_url: articleUrl,
      subject: 'Your Article Has Been Published',
      content: `
        <h2>Congratulations!</h2>
        <p>Your article "${article.title}" has been approved and published.</p>
        <a href="${articleUrl}" class="button">View Published Article</a>
        <p>Thank you for your contribution to ${this.siteName}!</p>
      `
    });

    return await this.sendEmail(
      email,
      'Your Article Has Been Published',
      html
    );
  }

  // Send comment notification to article author
  async sendCommentNotification(article, comment) {
    try {
      if (!article.author?.email) return;

      const articleUrl = `${this.siteUrl}/articles/${article.slug}#comment-${comment.id}`;
      
      const html = await this.loadTemplate('comment-notification', {
        article_title: article.title,
        comment_author: comment.author_name || comment.user?.username || 'Anonymous',
        comment_content: comment.content.substring(0, 200) + (comment.content.length > 200 ? '...' : ''),
        article_url: articleUrl,
        subject: 'New Comment on Your Article',
        content: `
          <h2>New Comment on Your Article</h2>
          <p>Someone commented on your article "${article.title}":</p>
          <blockquote style="border-left: 4px solid #3498db; padding-left: 15px; margin: 15px 0; background: #f8f9fa; padding: 15px;">
            ${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}
          </blockquote>
          <p><strong>By:</strong> ${comment.author_name || comment.user?.username || 'Anonymous'}</p>
          <a href="${articleUrl}" class="button">View Comment</a>
        `
      });

      return await this.sendEmail(
        article.author.email,
        'New Comment on Your Article',
        html
      );
    } catch (error) {
      logger.error('Failed to send comment notification:', error);
    }
  }

  // Test email configuration
  async testEmailConfiguration() {
    try {
      if (!this.isEnabled || !this.transporter) {
        return { 
          success: false, 
          error: 'Email service is disabled or not configured' 
        };
      }

      // First verify connection
      const isConnected = await this.verifyConnection();
      if (!isConnected) {
        return { 
          success: false, 
          error: 'Cannot connect to SMTP server' 
        };
      }

      const testEmail = process.env.ADMIN_EMAIL || this.fromEmail;
      
      const result = await this.sendEmail(
        testEmail,
        'Email Configuration Test',
        this.getDefaultTemplate({
          subject: 'Email Configuration Test',
          content: `
            <h2>✅ Email Test Successful!</h2>
            <p>If you receive this email, your email configuration is working correctly.</p>
            <p><strong>Test Details:</strong></p>
            <ul>
              <li><strong>SMTP Host:</strong> ${process.env.SMTP_HOST}</li>
              <li><strong>SMTP Port:</strong> ${process.env.SMTP_PORT}</li>
              <li><strong>From Email:</strong> ${this.fromEmail}</li>
              <li><strong>Test Time:</strong> ${new Date().toISOString()}</li>
            </ul>
          `
        })
      );
      
      return { success: true, message: 'Test email sent successfully', result };
    } catch (error) {
      logger.error('Email configuration test failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Enable/disable email service
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (enabled && !this.transporter && this.hasRequiredSmtpConfig()) {
      this.createTransporter();
    }
  }

  // Get email service status
  getStatus() {
    return {
      enabled: this.isEnabled,
      configured: this.hasRequiredSmtpConfig(),
      connected: !!this.transporter,
      settings: {
        host: process.env.SMTP_HOST || 'not configured',
        port: process.env.SMTP_PORT || 'not configured',
        user: process.env.SMTP_USER ? 'configured' : 'not configured',
        from: this.fromEmail
      }
    };
  }

  // Close transporter
  close() {
    if (this.transporter) {
      this.transporter.close();
      logger.info('Email transporter closed');
    }
  }
}

module.exports = new EmailService();