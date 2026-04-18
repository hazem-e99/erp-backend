import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Reminder } from './schemas/reminder.schema';
import { CreateReminderDto, UpdateReminderDto } from './dto/reminder.dto';

@Injectable()
export class RemindersService {
  constructor(
    @InjectModel(Reminder.name) private reminderModel: Model<Reminder>,
  ) {}

  async create(createReminderDto: CreateReminderDto, userId: string) {
    const reminder = new this.reminderModel({
      ...createReminderDto,
      userId,
      status: 'pending',
    });
    return reminder.save();
  }

  async findAll(userId: string) {
    return this.reminderModel
      .find({ userId })
      .sort({ reminderDate: 1 })
      .exec();
  }

  async findOne(id: string, userId: string) {
    const reminder = await this.reminderModel.findOne({ _id: id, userId });
    if (!reminder) {
      throw new NotFoundException('Reminder not found');
    }
    return reminder;
  }

  async update(id: string, updateReminderDto: UpdateReminderDto, userId: string) {
    const reminder = await this.reminderModel.findOneAndUpdate(
      { _id: id, userId },
      updateReminderDto,
      { new: true },
    );
    if (!reminder) {
      throw new NotFoundException('Reminder not found');
    }
    return reminder;
  }

  async remove(id: string, userId: string) {
    const result = await this.reminderModel.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Reminder not found');
    }
    return { message: 'Reminder deleted successfully' };
  }

  // Get pending reminders that need to be sent
  async getPendingReminders(): Promise<Array<{ reminder: any; period: string }>> {
    const now = new Date();
    const reminders = await this.reminderModel
      .find({ status: 'pending' })
      .populate('userId', 'email name')
      .exec();

    console.log(`Found ${reminders.length} pending reminder(s) in database`);

    const pendingToSend: Array<{ reminder: any; period: string }> = [];
    
    for (const reminder of reminders) {
      const reminderDate = new Date(reminder.reminderDate);
      const diffMs = reminderDate.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      const diffHours = diffMs / (1000 * 60 * 60);

      console.log(`Reminder: ${reminder.title}, Days until: ${diffDays.toFixed(2)}, Hours until: ${diffHours.toFixed(2)}`);
      console.log(`  Periods: ${JSON.stringify(reminder.reminderPeriods)}, SentAt: ${JSON.stringify(reminder.sentAt)}`);

      const periods = reminder.reminderPeriods || [];
      
      // Check if we should send reminder
      for (const period of periods) {
        let shouldSend = false;
        let periodKey = '';

        if (period === '7days' && diffDays >= 6.5 && diffDays <= 7.5) {
          shouldSend = true;
          periodKey = '7days';
        } else if (period === '3days' && diffDays >= 2.5 && diffDays <= 3.5) {
          shouldSend = true;
          periodKey = '3days';
        } else if (period === '24hours' && diffHours >= 20 && diffHours <= 28) {
          shouldSend = true;
          periodKey = '24hours';
        } else if (period === 'sameday' && diffHours >= 0 && diffHours <= 24) {
          shouldSend = true;
          periodKey = 'sameday';
        }

        if (shouldSend) {
          // Check if we already sent this period
          const alreadySent = reminder.sentAt?.some(date => {
            const sentDate = new Date(date);
            const timeSinceSent = now.getTime() - sentDate.getTime();
            // Don't send again within 12 hours
            return timeSinceSent < 12 * 60 * 60 * 1000;
          });

          if (!alreadySent) {
            pendingToSend.push({ reminder, period: periodKey });
          }
        }
      }
    }

    return pendingToSend;
  }

  async markAsSent(reminderId: string) {
    return this.reminderModel.findByIdAndUpdate(
      reminderId,
      { $push: { sentAt: new Date() } },
      { new: true },
    );
  }
}
