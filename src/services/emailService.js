// src/services/emailService.js
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransporter({
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

  // Send email
  async sendEmail(to, subject, html, text = null) {
    try {
      const mailOptions = {
        from: `${this.fromName} <${this.fromEmail}>`,
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
      .replace(/<[^>]*>/g, '')
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
      subject: 'Verify Your Email Address'
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
      subject: 'Reset Your Password'
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
      subject: `Welcome to ${this.siteName}!`
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
          subject: 'Article Pending Approval'
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
      subject: 'Your Article Has Been Published'
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
      subject: 'Article Requires Revision'
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
        subject: 'New Comment on Your Article'
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
        subject: 'Reply to Your Comment'
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

  // Send weekly newsletter
  async sendWeeklyNewsletter(subscribers, articles) {
    try {
      const html = await this.loadTemplate('newsletter', {
        articles: articles.map(article => ({
          title: article.title,
          excerpt: article.excerpt,
          url: `${this.siteUrl}/articles/${article.slug}`,
          author: article.author?.username || 'Unknown',
          published_date: new Date(article.published_at).toLocaleDateString()
        })),
        subject: `Weekly Newsletter - ${this.siteName}`
      });

      // Send to subscribers in batches
      const batchSize = 50;
      for (let i = 0; i < subscribers.length; i += batchSize) {
        const batch = subscribers.slice(i, i + batchSize);
        
        const promises = batch.map(subscriber => 
          this.sendEmail(
            subscriber.email,
            `Weekly Newsletter - ${this.siteName}`,
            html
          ).catch(error => {
            logger.error(`Failed to send newsletter to ${subscriber.email}:`, error);
          })
        );

        await Promise.all(promises);
        
        // Wait between batches to avoid rate limiting
        if (i + batchSize < subscribers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      logger.error('Failed to send newsletter:', error);
      throw error;
    }
  }

  // Send user role change notification
  async sendRoleChangeNotification(user, oldRole, newRole) {
    const html = await this.loadTemplate('role-change', {
      user_name: user.first_name || user.username,
      old_role: oldRole,
      new_role: newRole,
      dashboard_url: `${this.siteUrl}/dashboard`,
      subject: 'Your Account Role Has Been Updated'
    });

    await this.sendEmail(
      user.email,
      'Your Account Role Has Been Updated',
      html
    );
  }

  // Send account deactivation notification
  async sendAccountDeactivationNotification(email, reason = '') {
    const html = await this.loadTemplate('account-deactivation', {
      reason: reason,
      contact_url: `${this.siteUrl}/contact`,
      subject: 'Account Deactivated'
    });

    await this.sendEmail(
      email,
      'Account Deactivated',
      html
    );
  }

  // Send bulk email
  async sendBulkEmail(recipients, subject, template, variables = {}) {
    try {
      const html = await this.loadTemplate(template, variables);
      const batchSize = 50;
      let sent = 0;
      let failed = 0;

      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);
        
        const promises = batch.map(async (recipient) => {
          try {
            await this.sendEmail(recipient.email, subject, html);
            sent++;
          } catch (error) {
            failed++;
            logger.error(`Failed to send email to ${recipient.email}:`, error);
          }
        });

        await Promise.all(promises);
        
        // Wait between batches
        if (i + batchSize < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return { sent, failed, total: recipients.length };
    } catch (error) {
      logger.error('Failed to send bulk email:', error);
      throw error;
    }
  }

  // Send system maintenance notification
  async sendMaintenanceNotification(users, maintenanceInfo) {
    const html = await this.loadTemplate('maintenance', {
      maintenance_start: maintenanceInfo.startTime,
      maintenance_end: maintenanceInfo.endTime,
      maintenance_reason: maintenanceInfo.reason,
      estimated_duration: maintenanceInfo.duration,
      subject: 'Scheduled System Maintenance'
    });

    return await this.sendBulkEmail(
      users,
      'Scheduled System Maintenance',
      'maintenance',
      {
        maintenance_start: maintenanceInfo.startTime,
        maintenance_end: maintenanceInfo.endTime,
        maintenance_reason: maintenanceInfo.reason,
        estimated_duration: maintenanceInfo.duration
      }
    );
  }

  // Send security alert
  async sendSecurityAlert(email, alertInfo) {
    const html = await this.loadTemplate('security-alert', {
      alert_type: alertInfo.type,
      alert_time: alertInfo.timestamp,
      ip_address: alertInfo.ipAddress,
      user_agent: alertInfo.userAgent,
      action_taken: alertInfo.action,
      secure_account_url: `${this.siteUrl}/security`,
      subject: 'Security Alert - Suspicious Activity Detected'
    });

    await this.sendEmail(
      email,
      'Security Alert - Suspicious Activity Detected',
      html
    );
  }

  // Send digest email (daily/weekly summary)
  async sendDigestEmail(user, digestData, period = 'weekly') {
    const html = await this.loadTemplate('digest', {
      user_name: user.first_name || user.username,
      period: period,
      total_articles: digestData.totalArticles,
      total_views: digestData.totalViews,
      total_comments: digestData.totalComments,
      top_articles: digestData.topArticles,
      dashboard_url: `${this.siteUrl}/dashboard`,
      subject: `Your ${period.charAt(0).toUpperCase() + period.slice(1)} Digest`
    });

    await this.sendEmail(
      user.email,
      `Your ${period.charAt(0).toUpperCase() + period.slice(1)} Digest`,
      html
    );
  }

  // Send article mention notification
  async sendMentionNotification(mentionedUser, article, mentionContext) {
    const articleUrl = `${this.siteUrl}/articles/${article.slug}`;
    
    const html = await this.loadTemplate('mention-notification', {
      mentioned_user: mentionedUser.first_name || mentionedUser.username,
      article_title: article.title,
      article_author: article.author?.username || 'Unknown',
      mention_context: mentionContext,
      article_url: articleUrl,
      subject: 'You Were Mentioned in an Article'
    });

    await this.sendEmail(
      mentionedUser.email,
      'You Were Mentioned in an Article',
      html
    );
  }

  // Test email configuration
  async testEmailConfiguration() {
    try {
      await this.sendEmail(
        process.env.ADMIN_EMAIL || this.fromEmail,
        'Email Configuration Test',
        '<h1>Email Test</h1><p>If you receive this email, your email configuration is working correctly.</p>'
      );
      
      return { success: true, message: 'Test email sent successfully' };
    } catch (error) {
      logger.error('Email configuration test failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Get email statistics
  async getEmailStats() {
    try {
      // This would typically come from a database or email service provider
      return {
        totalSent: 0,
        totalDelivered: 0,
        totalBounced: 0,
        totalOpened: 0,
        totalClicked: 0,
        deliveryRate: 0,
        openRate: 0,
        clickRate: 0
      };
    } catch (error) {
      logger.error('Failed to get email statistics:', error);
      throw error;
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