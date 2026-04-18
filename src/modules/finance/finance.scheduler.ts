import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RevenueService } from './services/revenue.service';
import { InstallmentsService } from './services/installments.service';
import { SubscriptionsService } from './services/subscriptions.service';
import { FinanceGateway } from './finance.gateway';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription, SubscriptionDocument, SubscriptionStatus } from './schemas/subscription.schema';

@Injectable()
export class FinanceScheduler {
  private readonly logger = new Logger(FinanceScheduler.name);

  constructor(
    private readonly revenueService: RevenueService,
    private readonly installmentsService: InstallmentsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly gateway: FinanceGateway,
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  /** Revenue recognition — runs daily at 00:05 */
  @Cron('5 0 * * *')
  async runRevenueRecognition() {
    this.logger.log('Running revenue recognition job...');
    const count = await this.revenueService.runRecognitionJob();
    this.logger.log(`Revenue recognized: ${count} entries`);
  }

  /** Mark overdue installments — runs daily at 00:10 */
  @Cron('10 0 * * *')
  async markOverdueInstallments() {
    this.logger.log('Checking overdue installments...');
    const count = await this.installmentsService.markOverdue();
    this.logger.log(`Marked overdue: ${count} installments`);
  }

  /** Complete expired subscriptions — runs daily at 00:15 */
  @Cron('15 0 * * *')
  async completeExpiredSubscriptions() {
    this.logger.log('Checking expired subscriptions...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expired = await this.subscriptionModel.find({
      endDate: { $lt: today },
      status: SubscriptionStatus.ACTIVE,
    });

    for (const sub of expired) {
      sub.status = SubscriptionStatus.COMPLETED;
      await sub.save();
      this.gateway.emitFinanceUpdate('subscription:completed', {
        subscriptionId: sub._id.toString(),
        clientName: sub.clientName,
      });
    }
    this.logger.log(`Completed ${expired.length} subscriptions`);
  }

  /** Send 3-day reminders — runs daily at 08:00 */
  @Cron('0 8 * * *')
  async sendUpcomingReminders() {
    this.logger.log('Checking upcoming installment reminders...');
    const upcoming = await this.installmentsService.getUpcomingDue(3);
    for (const inst of upcoming) {
      this.gateway.emitFinanceUpdate('installment:reminder', {
        installmentId: inst._id.toString(),
        clientName: inst.clientName,
        amount: inst.amount,
        dueDate: inst.dueDate,
        daysUntilDue: 3,
      });
      await this.installmentsService.markReminderSent(inst._id.toString());
    }
    this.logger.log(`Sent ${upcoming.length} reminders`);
  }

  /** Alert subscriptions expiring in 5 days — runs daily at 08:05 */
  @Cron('5 8 * * *')
  async alertExpiringSubscriptions() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(today);
    target.setDate(today.getDate() + 5);

    const expiring = await this.subscriptionModel.find({
      endDate: { $gte: today, $lte: target },
      status: SubscriptionStatus.ACTIVE,
    });

    for (const sub of expiring) {
      this.gateway.emitFinanceUpdate('subscription:expiring', {
        subscriptionId: sub._id.toString(),
        clientName: sub.clientName,
        endDate: sub.endDate,
      });
    }
  }
}
