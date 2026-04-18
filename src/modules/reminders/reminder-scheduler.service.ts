import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { RemindersService } from './reminders.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  constructor(
    private readonly remindersService: RemindersService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    console.log('✅ ReminderSchedulerService initialized!');
  }

  // Run every 30 seconds for testing (change back to EVERY_HOUR in production)
  @Interval(30000)
  async checkAndSendReminders() {
    console.log('Checking for pending reminders...');

    try {
      const pendingReminders = await this.remindersService.getPendingReminders();
      
      console.log(`Found ${pendingReminders.length} pending reminder(s) to send`);
      
      for (const { reminder, period } of pendingReminders) {
        const user = reminder.userId as any;
        
        console.log('Processing reminder:', {
          title: reminder.title,
          user: user?.email || 'NO EMAIL',
          period
        });
        
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
            
            console.log(`✅ Reminder sent to ${user.email} for: ${reminder.title}`);
          } catch (emailError) {
            console.error(`❌ Failed to send email to ${user.email}:`, emailError.message);
          }
        } else {
          console.log('⚠️ No user email found for reminder:', reminder.title);
        }
      }

      if (pendingReminders.length > 0) {
        console.log(`Sent ${pendingReminders.length} reminder(s)`);
      }
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }
}
