import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // Configure Gmail SMTP
    // You'll need to set these environment variables in .env
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER, // Your Gmail address
        pass: process.env.EMAIL_PASSWORD, // Your Gmail app password
      },
    });
  }

  async sendReminderEmail(
    to: string,
    subject: string,
    reminder: {
      title: string;
      description: string;
      amount?: number;
      reminderDate: Date;
      period: string;
    },
  ) {
    const periodLabels = {
      '7days': '7 أيام',
      '3days': '3 أيام',
      '24hours': '24 ساعة',
      'sameday': 'اليوم',
    };

    const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 30px; }
    .reminder-card { background: #f8f9fa; border-left: 4px solid #667eea; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .reminder-card h2 { margin-top: 0; color: #333; }
    .reminder-card p { margin: 10px 0; color: #666; line-height: 1.6; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e0e0e0; }
    .detail-row:last-child { border-bottom: none; }
    .label { font-weight: bold; color: #555; }
    .value { color: #333; }
    .amount { font-size: 24px; font-weight: bold; color: #667eea; }
    .alert { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; color: #856404; }
    .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; background: #f8f9fa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 تذكير مهم</h1>
      <p>ERP System Reminder</p>
    </div>
    <div class="content">
      <div class="alert">
        ⏰ هذا تذكير قبل الموعد بـ <strong>${periodLabels[reminder.period] || reminder.period}</strong>
      </div>
      
      <div class="reminder-card">
        <h2>${reminder.title}</h2>
        <p>${reminder.description}</p>
        
        <div style="margin-top: 20px;">
          <div class="detail-row">
            <span class="label">📅 التاريخ:</span>
            <span class="value">${new Date(reminder.reminderDate).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          
          ${reminder.amount ? `
          <div class="detail-row">
            <span class="label">💰 المبلغ:</span>
            <span class="amount">${reminder.amount.toLocaleString()} جنيه</span>
          </div>
          ` : ''}
        </div>
      </div>
      
      <p style="text-align: center; margin-top: 30px; color: #666;">
        تم إرسال هذا التذكير تلقائياً من نظام ERP الخاص بك
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} ERP System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    try {
      await this.transporter.sendMail({
        from: `"ERP System" <${process.env.EMAIL_USER}>`,
        to,
        subject: `🔔 ${subject}`,
        html: htmlContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to send email:', error);
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    try {
      await this.transporter.verify();
      return { success: true, message: 'Email service is ready' };
    } catch (error) {
      console.error('Email service error:', error);
      return { success: false, error: error.message };
    }
  }
}
