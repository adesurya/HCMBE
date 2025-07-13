// src/services/emailService.js - Enhanced version with SSL certificate fixes
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
    this.transporter = null;
    
    // Initialize email service
    this.initialize();
  }

  // Initialize email service with better error handling
  async initialize() {
    try {
      if (!this.isEnabled) {
        logger.info('📧 Email service disabled (EMAIL_ENABLED=false)');
        return;
      }

      if (!this.hasRequiredSmtpConfig()) {
        logger.warn('📧 Email service disabled - Missing SMTP configuration');
        logger.info('💡 To enable email service, set these environment variables:');
        logger.info('   - EMAIL_ENABLED=true');
        logger.info('   - SMTP_HOST=your.smtp.host');
        logger.info('   - SMTP_PORT=587');
        logger.info('   - SMTP_USER=your.email@domain.com');
        logger.info('   - SMTP_PASS=your_password');
        this.isEnabled = false;
        return;
      }

      await this.createTransporter();
    } catch (error) {
      logger.error('📧 Email service initialization failed:', error.message);
      
      // Don't disable completely, just mark as not connected
      // This allows the app to continue running
      this.transporter = null;
      
      // Provide helpful error-specific guidance
      this.handleInitializationError(error);
    }
  }

  // Handle initialization errors with specific guidance
  handleInitializationError(error) {
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('self-signed certificate') || 
        errorMessage.includes('certificate') || 
        errorMessage.includes('ssl') ||
        errorMessage.includes('tls')) {
      
      logger.info('🔧 SSL Certificate Issue Detected:');
      logger.info('   This is common with local mail servers or some SMTP providers.');
      logger.info('   Solutions:');
      logger.info('   1. Add SMTP_REJECT_UNAUTHORIZED=false to your .env file');
      logger.info('   2. Or use a different SMTP provider (Gmail, SendGrid, etc.)');
      logger.info('   3. Or disable email with EMAIL_ENABLED=false');
      
    } else if (errorMessage.includes('econnrefused') || errorMessage.includes('enotfound')) {
      
      logger.info('🔧 Connection Issue Detected:');
      logger.info('   - Check if SMTP_HOST and SMTP_PORT are correct');
      logger.info('   - Verify your internet connection');
      logger.info('   - Try a different SMTP provider');
      
    } else if (errorMessage.includes('auth') || errorMessage.includes('login')) {
      
      logger.info('🔧 Authentication Issue Detected:');
      logger.info('   - Check SMTP_USER and SMTP_PASS are correct');
      logger.info('   - For Gmail: Use App Password instead of regular password');
      
    }
    
    logger.info('📧 Email service will continue in mock mode (emails will be logged but not sent)');
  }

  // Check if required SMTP configuration exists
  hasRequiredSmtpConfig() {
    const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      logger.debug(`Missing SMTP config: ${missing.join(', ')}`);
      return false;
    }
    
    return true;
  }

  // Create email transporter with SSL certificate handling
  async createTransporter() {
    try {
      const transportConfig = {
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
      };

      // Handle SSL/TLS configuration based on environment and settings
      const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED !== 'false';
      
      if (process.env.NODE_ENV === 'development' || !rejectUnauthorized) {
        // More permissive SSL settings for development or when explicitly disabled
        transportConfig.tls = {
          rejectUnauthorized: false,
          ciphers: 'SSLv3',
          secureProtocol: 'TLSv1_method'
        };
        logger.info('📧 Using permissive SSL settings for development');
      } else {
        // Production SSL settings
        transportConfig.tls = {
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2'
        };
      }

      // Special configuration for common providers
      const host = process.env.SMTP_HOST?.toLowerCase();
      if (host?.includes('gmail')) {
        transportConfig.service = 'gmail';
        logger.info('📧 Using Gmail service configuration');
      } else if (host?.includes('outlook') || host?.includes('hotmail')) {
        transportConfig.service = 'hotmail';
        logger.info('📧 Using Outlook service configuration');
      } else if (host?.includes('yahoo')) {
        transportConfig.service = 'yahoo';
        logger.info('📧 Using Yahoo service configuration');
      }

      this.transporter = nodemailer.createTransport(transportConfig);

      // Test connection with fallback
      const isConnected = await this.verifyConnection();
      if (!isConnected) {
        // Try with more permissive settings
        logger.info('📧 Retrying with more permissive SSL settings...');
        transportConfig.tls = {
          rejectUnauthorized: false,
          ciphers: 'SSLv3'
        };
        
        this.transporter = nodemailer.createTransport(transportConfig);
        const retryConnected = await this.verifyConnection();
        
        if (!retryConnected) {
          throw new Error('SMTP connection verification failed after retry');
        }
      }

      logger.info('✅ Email service initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to create email transporter:', error.message);
      throw error;
    }
  }

  // Verify SMTP connection with timeout and retry
  async verifyConnection() {
    if (!this.transporter) {
      return false;
    }

    try {
      // Add timeout to verification
      const verificationPromise = this.transporter.verify();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 15000) // Increased to 15 seconds
      );

      await Promise.race([verificationPromise, timeoutPromise]);
      logger.info('✅ SMTP connection verified successfully');
      return true;
    } catch (error) {
      logger.error('❌ SMTP connection verification failed:', error.message);
      return false;
    }
  }

  // Load email template with fallback
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

  // Get default template
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
              <a href="${this.siteUrl}">Visit our website</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Send email with comprehensive error handling
  async sendEmail(to, subject, html, text = null) {
    // If email service is disabled or no transporter, log and return success
    if (!this.isEnabled || !this.transporter) {
      logger.info(`📧 [MOCK] Email would be sent to ${to}: ${subject}`);
      if (process.env.NODE_ENV === 'development') {
        logger.debug('📧 Email content preview:', { to, subject, html: html.substring(0, 200) + '...' });
      }
      return { 
        messageId: 'mock-' + Date.now(), 
        info: 'Email service in mock mode - email logged but not sent',
        success: true 
      };
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
      return { ...result, success: true };
    } catch (error) {
      logger.error(`❌ Failed to send email to ${to}:`, {
        subject,
        error: error.message,
        code: error.code
      });

      // Return a structured error response instead of throwing
      return { 
        messageId: null, 
        error: error.message, 
        success: false,
        code: error.code 
      };
    }
  }

  // Convert HTML to plain text
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
      const result = await emailFunction.apply(this, args);
      return result.success;
    } catch (error) {
      logger.error('Email sending failed:', error.message);
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

  // Test email configuration
  async testEmailConfiguration() {
    try {
      if (!this.isEnabled) {
        return { 
          success: false, 
          error: 'Email service is disabled. Set EMAIL_ENABLED=true and configure SMTP settings.' 
        };
      }

      if (!this.transporter) {
        return { 
          success: false, 
          error: 'No email transporter available. Check SMTP configuration and SSL settings.' 
        };
      }

      // Test connection first
      const isConnected = await this.verifyConnection();
      if (!isConnected) {
        return { 
          success: false, 
          error: 'Cannot connect to SMTP server. Check SMTP settings and SSL configuration.' 
        };
      }

      const testEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER || this.fromEmail;
      
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
              <li><strong>SSL Reject Unauthorized:</strong> ${process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'}</li>
              <li><strong>Test Time:</strong> ${new Date().toISOString()}</li>
            </ul>
          `
        })
      );
      
      return { 
        success: result.success, 
        message: result.success ? 'Test email sent successfully' : 'Failed to send test email', 
        result 
      };
    } catch (error) {
      logger.error('Email configuration test failed:', error);
      return { success: false, error: error.message };
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
        from: this.fromEmail,
        secure: process.env.SMTP_PORT === '465',
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
      }
    };
  }

  // Enable/disable email service
  async setEnabled(enabled) {
    this.isEnabled = enabled;
    if (enabled && !this.transporter && this.hasRequiredSmtpConfig()) {
      await this.initialize();
    } else if (!enabled) {
      this.close();
    }
  }

  // Close transporter
  close() {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
      logger.info('📧 Email transporter closed');
    }
  }

  // Additional email methods with error handling...
  async sendApprovalNotification(article) {
    try {
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

        await this.safeEmailSend(this.sendEmail.bind(this), editor.email, 'Article Pending Approval', html);
      }
    } catch (error) {
      logger.error('Failed to send approval notifications:', error.message);
    }
  }

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
      logger.error('Failed to send comment notification:', error.message);
    }
  }
}

module.exports = new EmailService();