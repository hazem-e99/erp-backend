import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { RemindersService } from './reminders.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private isChecking = false; // Prevent duplicate runs
  private readonly DEBUG_MODE = process.env.REMINDER_DEBUG === 'true';

  constructor(
    private readonly remindersService: RemindersService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    console.log('✅ ReminderSchedulerService initialized!');
    console.log(`⏰ Checking reminders every 5 minutes (Debug mode: ${this.DEBUG_MODE})`);
  }

  // Run every 5 minutes (change to @Cron(CronExpression.EVERY_HOUR) in production)
  @Interval(300000) // 5 minutes = 300,000ms
  async checkAndSendReminders() {
    if (this.isChecking) return; // Skip if already running
    this.isChecking = true;

    if (this.DEBUG_MODE) {
      console.log('\n🔍 Checking for pending reminders...');
    }

    try {
      // ─── 1) Existing period-based reminders (7days, 3days, 24hours, sameday) ───
      const pendingReminders = await this.remindersService.getPendingReminders(this.DEBUG_MODE);
      
      if (pendingReminders.length > 0) {
        console.log(`\n📬 Found ${pendingReminders.length} period-based reminder(s) to send`);
      }
      
      for (const { reminder, period } of pendingReminders) {
        const user = reminder.userId as any;
        
        if (user && user.email) {
          const subject = `تذكير: ${reminder.title}`;
          
          try {
            await this.emailService.sendReminderEmail(
              user.email,
              subject,
              {
                title: reminder.title,
                description: reminder.description,
                amount: reminder.amount,
                reminderDate: reminder.reminderDate,
                period,
              },
            );

            // Mark as sent
            await this.remindersService.markAsSent(reminder._id);
            
            console.log(`   ✅ Sent "${reminder.title}" to ${user.email} (${period})`);
          } catch (emailError) {
            console.error(`   ❌ Failed to send to ${user.email}:`, emailError.message);
          }
        } else {
          console.log(`   ⚠️ No email for: ${reminder.title}`);
        }
      }

      // ─── 2) Monthly recurring reminders ───
      const monthlyReminders = await this.remindersService.getMonthlyRecurringReminders(this.DEBUG_MODE);

      if (monthlyReminders.length > 0) {
        console.log(`\n🔁 Found ${monthlyReminders.length} monthly recurring reminder(s) to send`);
      }

      for (const { reminder } of monthlyReminders) {
        const user = reminder.userId as any;

        if (user && user.email) {
          const subject = `تذكير شهري: ${reminder.title}`;

          try {
            await this.emailService.sendReminderEmail(
              user.email,
              subject,
              {
                title: reminder.title,
                description: reminder.description,
                amount: reminder.amount,
                reminderDate: reminder.reminderDate,
                period: 'monthly',
              },
            );

            // Advance this reminder to next month
            await this.remindersService.advanceToNextMonth(reminder._id);

            console.log(`   ✅ Sent monthly "${reminder.title}" to ${user.email} (day ${reminder.monthlyDay})`);
          } catch (emailError) {
            console.error(`   ❌ Failed to send monthly to ${user.email}:`, emailError.message);
          }
        } else {
          console.log(`   ⚠️ No email for monthly: ${reminder.title}`);
        }
      }
    } catch (error) {
      console.error('❌ Error checking reminders:', error.message);
    } finally {
      this.isChecking = false;
    }
  }
}
