// src/services/emailService.js
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    // Fix: Use createTransport, not createTransporter
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100
    });

    this.fromEmail = process.env.FROM_EMAIL;
    this.fromName = process.env.FROM_NAME;
    this.siteUrl = process.env.SITE_URL;
    this.siteName = process.env.SITE_NAME;

    this.verifyConnection();
  }

  // Verify SMTP connection
  async verifyConnection() {
    try {
      await this.transporter.verify();
      logger.info('Email service connected successfully');
    } catch (error) {
      logger.error('Email service connection failed:', error);
    }
  }

  // Load email template
  async loadTemplate(templateName, variables = {}) {
    try {
      const templatePath = path.join(__dirname, '../templates/emails', `${templateName}.html`);
      let template = await fs.readFile(templatePath, 'utf8');

      // Replace variables in template
      Object.keys(variables).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        template = template.replace(regex, variables[key]);
      });

      // Replace default variables
      template = template.replace(/{{SITE_NAME}}/g, this.siteName);
      template = template.replace(/{{SITE_URL}}/g, this.siteUrl);
      template = template.replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear());

      return template;
    } catch (error) {
      logger.error(`Error loading email template ${templateName}:`, error);
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
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .header h1 { color: #2c3e50; margin: 0; }
          .content { margin-bottom: 30px; }
          .button { display: inline-block; padding: 12px 24px; background: #3498db; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
          .footer { text-align: center; color: #666; font-size: 14px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${this.siteName || 'News Portal'}</h1>
          </div>
          <div class="content">
            ${variables.content || 'Thank you for using our service.'}
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${this.siteName || 'News Portal'}. All rights reserved.</p>
            <p>
              <a href="${this.siteUrl || '#'}">Visit our website</a> | 
              <a href="${this.siteUrl || '#'}/unsubscribe">Unsubscribe</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Send email
  async sendEmail(to, subject, html, text = null) {
    try {
      const mailOptions = {
        from: `${this.fromName || 'News Portal'} <${this.fromEmail || 'noreply@example.com'}>`,
        to,
        subject,
        html,
        text: text || this.htmlToText(html)
      };

      const result = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent successfully to ${to}: ${subject}`);
      return result;
    } catch (error) {
      logger.error(`Failed to send email to ${to}:`, error);
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
      .trim();
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

    await this.sendEmail(
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

    await this.sendEmail(
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

    await this.sendEmail(
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

        await this.sendEmail(
          editor.email,
          'Article Pending Approval',
          html
        );
      }
    } catch (error) {
      logger.error('Failed to send approval notifications:', error);
      throw error;
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

    await this.sendEmail(
      email,
      'Your Article Has Been Published',
      html
    );
  }

  // Send rejection notification to author
  async sendRejectionNotification(email, article, reason = '') {
    const editUrl = `${this.siteUrl}/admin/articles/${article.id}/edit`;
    
    const html = await this.loadTemplate('rejection-notification', {
      article_title: article.title,
      rejection_reason: reason,
      edit_url: editUrl,
      subject: 'Article Requires Revision',
      content: `
        <h2>Article Requires Revision</h2>
        <p>Your article "${article.title}" needs some revisions before it can be published.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <a href="${editUrl}" class="button">Edit Article</a>
        <p>Please make the necessary changes and resubmit for approval.</p>
      `
    });

    await this.sendEmail(
      email,
      'Article Requires Revision',
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
          <blockquote style="border-left: 4px solid #3498db; padding-left: 15px; margin: 15px 0;">
            ${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}
          </blockquote>
          <p><strong>By:</strong> ${comment.author_name || comment.user?.username || 'Anonymous'}</p>
          <a href="${articleUrl}" class="button">View Comment</a>
        `
      });

      await this.sendEmail(
        article.author.email,
        'New Comment on Your Article',
        html
      );
    } catch (error) {
      logger.error('Failed to send comment notification:', error);
    }
  }

  // Send reply notification to parent comment author
  async sendReplyNotification(parentComment, reply, article) {
    try {
      if (!parentComment.author_email && !parentComment.user?.email) return;

      const email = parentComment.author_email || parentComment.user.email;
      const articleUrl = `${this.siteUrl}/articles/${article.slug}#comment-${reply.id}`;
      
      const html = await this.loadTemplate('reply-notification', {
        original_comment: parentComment.content.substring(0, 100) + '...',
        reply_author: reply.author_name || reply.user?.username || 'Anonymous',
        reply_content: reply.content.substring(0, 200) + (reply.content.length > 200 ? '...' : ''),
        article_title: article.title,
        article_url: articleUrl,
        subject: 'Reply to Your Comment',
        content: `
          <h2>Someone Replied to Your Comment</h2>
          <p>You received a reply on the article "${article.title}":</p>
          <p><strong>Your comment:</strong></p>
          <blockquote style="border-left: 4px solid #95a5a6; padding-left: 15px; margin: 15px 0;">
            ${parentComment.content.substring(0, 100)}...
          </blockquote>
          <p><strong>Reply:</strong></p>
          <blockquote style="border-left: 4px solid #3498db; padding-left: 15px; margin: 15px 0;">
            ${reply.content.substring(0, 200)}${reply.content.length > 200 ? '...' : ''}
          </blockquote>
          <p><strong>By:</strong> ${reply.author_name || reply.user?.username || 'Anonymous'}</p>
          <a href="${articleUrl}" class="button">View Reply</a>
        `
      });

      await this.sendEmail(
        email,
        'Reply to Your Comment',
        html
      );
    } catch (error) {
      logger.error('Failed to send reply notification:', error);
    }
  }

  // Test email configuration
  async testEmailConfiguration() {
    try {
      const testEmail = process.env.ADMIN_EMAIL || this.fromEmail;
      
      await this.sendEmail(
        testEmail,
        'Email Configuration Test',
        this.getDefaultTemplate({
          subject: 'Email Configuration Test',
          content: `
            <h2>Email Test Successful!</h2>
            <p>If you receive this email, your email configuration is working correctly.</p>
            <p><strong>Test Details:</strong></p>
            <ul>
              <li>SMTP Host: ${process.env.SMTP_HOST}</li>
              <li>SMTP Port: ${process.env.SMTP_PORT}</li>
              <li>From Email: ${this.fromEmail}</li>
              <li>Test Time: ${new Date().toISOString()}</li>
            </ul>
          `
        })
      );
      
      return { success: true, message: 'Test email sent successfully' };
    } catch (error) {
      logger.error('Email configuration test failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Close transporter
  close() {
    if (this.transporter) {
      this.transporter.close();
    }
  }
}

module.exports = new EmailService();