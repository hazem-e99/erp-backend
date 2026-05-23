import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AnnouncementsService } from '../announcements/announcements.service';
import {
  PayrollConfig,
  PayrollConfigDocument,
} from '../payroll/schemas/payroll-config.schema';
import {
  Payroll,
  PayrollDocument,
} from '../payroll/schemas/payroll.schema';
import {
  Installment,
  InstallmentDocument,
  InstallmentStatus,
} from '../finance/schemas/installment.schema';

const PAYROLL_PERMISSIONS = ['payroll:read', 'payroll:create', 'payroll:update'];
const FINANCE_PERMISSIONS = ['finance:read', 'finance:create', 'finance:update'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC date at 00:00 for a given Date. */
function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((toUtcMidnight(a).getTime() - toUtcMidnight(b).getTime()) / DAY_MS);
}

function isoDay(d: Date): string {
  return toUtcMidnight(d).toISOString().slice(0, 10);
}

/**
 * Generates in-app notifications when payments are coming up:
 *   - Payroll cycle payment day (3 days before + 1 day before + same day)
 *   - Customer installments due (3 days before + same day + overdue)
 *
 * Each notification uses a stable `dedupKey` so the cron can fire hourly
 * without creating duplicates.
 */
@Injectable()
export class PaymentNotificationsScheduler implements OnModuleInit {
  private readonly logger = new Logger(PaymentNotificationsScheduler.name);

  constructor(
    private readonly announcementsService: AnnouncementsService,
    @InjectModel(PayrollConfig.name)
    private payrollConfigModel: Model<PayrollConfigDocument>,
    @InjectModel(Payroll.name)
    private payrollModel: Model<PayrollDocument>,
    @InjectModel(Installment.name)
    private installmentModel: Model<InstallmentDocument>,
  ) {}

  onModuleInit() {
    this.logger.log('PaymentNotificationsScheduler initialized');
    // Run once on startup so the bell reflects current state immediately.
    void this.tick().catch((e) =>
      this.logger.error(`Initial tick failed: ${e?.message ?? e}`),
    );
  }

  /** Hourly cron — cheap, dedup-protected. */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyTick() {
    await this.tick();
  }

  async tick() {
    try {
      await this.checkPayrollDue();
    } catch (e: any) {
      this.logger.error(`Payroll check failed: ${e?.message ?? e}`);
    }
    try {
      await this.checkInstallmentsDue();
    } catch (e: any) {
      this.logger.error(`Installment check failed: ${e?.message ?? e}`);
    }
    try {
      await this.checkPendingSalaryExpenses();
    } catch (e: any) {
      this.logger.error(`Pending salary expenses check failed: ${e?.message ?? e}`);
    }
  }

  // ── Payroll payment day reminders ──────────────────────────────────────────

  private async checkPayrollDue() {
    const config =
      (await this.payrollConfigModel.findOne().lean()) ||
      ({ cycleStartDay: 26, cycleEndDay: 25, paymentDay: 25 } as any);

    const now = new Date();
    const paymentDay: number = config.paymentDay || 25;

    // Find the next payment day at-or-after today.
    const todayUtc = toUtcMidnight(now);
    let paymentDate = new Date(
      Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), paymentDay),
    );
    if (paymentDate < todayUtc) {
      paymentDate = new Date(
        Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() + 1, paymentDay),
      );
    }

    const diff = daysBetween(paymentDate, todayUtc);
    if (diff > 7) return; // too far away

    const month = paymentDate.getUTCMonth() + 1;
    const year = paymentDate.getUTCFullYear();
    const monthLabel = paymentDate.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const recipients =
      await this.announcementsService.resolveUsersByPermission(PAYROLL_PERMISSIONS);
    if (recipients.length === 0) return;

    const baseKey = `payroll-due:${year}-${String(month).padStart(2, '0')}`;

    const tiers: Array<{ when: number; window: [number, number]; label: string; tone: string }> = [
      { when: 7, window: [6, 7], label: '7d', tone: 'in 7 days' },
      { when: 3, window: [2, 3], label: '3d', tone: 'in 3 days' },
      { when: 1, window: [1, 1], label: '1d', tone: 'tomorrow' },
      { when: 0, window: [0, 0], label: '0d', tone: 'today' },
    ];

    for (const tier of tiers) {
      if (diff < tier.window[0] || diff > tier.window[1]) continue;

      await this.announcementsService.createSystemNotifications({
        userIds: recipients,
        title: `Payroll payment due ${tier.tone}`,
        message: `Salary payments for ${monthLabel} are due on ${isoDay(
          paymentDate,
        )}. Review payrolls and mark them as paid in the Payroll module.`,
        type: 'payroll',
        link: '/dashboard/payroll',
        dedupKey: `${baseKey}:${tier.label}`,
      });
    }
  }

  // ── Installments due / overdue reminders ───────────────────────────────────

  private async checkInstallmentsDue() {
    const now = new Date();
    const todayUtc = toUtcMidnight(now);
    const sevenDaysAhead = new Date(todayUtc.getTime() + 7 * DAY_MS);

    const upcoming = await this.installmentModel
      .find({
        status: {
          $in: [
            InstallmentStatus.PENDING,
            InstallmentStatus.PARTIALLY_PAID,
            InstallmentStatus.OVERDUE,
          ],
        },
        dueDate: { $lte: sevenDaysAhead },
      })
      .lean();

    if (upcoming.length === 0) return;

    const recipients =
      await this.announcementsService.resolveUsersByPermission(FINANCE_PERMISSIONS);
    if (recipients.length === 0) return;

    for (const inst of upcoming) {
      const diff = daysBetween(new Date(inst.dueDate), todayUtc);
      // diff > 0: upcoming, diff == 0: today, diff < 0: overdue
      const due = isoDay(new Date(inst.dueDate));
      const amount = (inst.baseAmount ?? inst.amount ?? 0).toLocaleString();
      const client = inst.clientName || 'Client';
      const num = `${inst.installmentNumber}/${inst.totalInstallments}`;

      let tierLabel: string | null = null;
      let title = '';
      let message = '';

      if (diff < 0) {
        // Overdue: only fire once per day per installment to avoid spam.
        tierLabel = `overdue:${isoDay(todayUtc)}`;
        const overdueDays = Math.abs(diff);
        title = `Installment overdue — ${client}`;
        message = `Installment ${num} for ${client} is ${overdueDays} day(s) overdue. Amount: ${amount}. Due date was ${due}.`;
      } else if (diff === 0) {
        tierLabel = '0d';
        title = `Installment due today — ${client}`;
        message = `Installment ${num} for ${client} is due today (${due}). Amount: ${amount}.`;
      } else if (diff === 1) {
        tierLabel = '1d';
        title = `Installment due tomorrow — ${client}`;
        message = `Installment ${num} for ${client} is due tomorrow (${due}). Amount: ${amount}.`;
      } else if (diff >= 2 && diff <= 3) {
        tierLabel = '3d';
        title = `Installment due in ${diff} days — ${client}`;
        message = `Installment ${num} for ${client} is due on ${due}. Amount: ${amount}.`;
      } else if (diff >= 6 && diff <= 7) {
        tierLabel = '7d';
        title = `Installment due in a week — ${client}`;
        message = `Installment ${num} for ${client} is due on ${due}. Amount: ${amount}.`;
      }

      if (!tierLabel) continue;

      await this.announcementsService.createSystemNotifications({
        userIds: recipients,
        title,
        message,
        type: 'installment',
        link: '/dashboard/finance',
        dedupKey: `installment-due:${inst._id}:${tierLabel}`,
      });
    }
  }

  // ── Pending salary expenses (payrolls paid but not recorded yet) ───────────

  private async checkPendingSalaryExpenses() {
    const pendingCount = await this.payrollModel.countDocuments({
      status: 'paid',
      isRecordedAsExpense: false,
    });
    if (pendingCount === 0) return;

    const recipients =
      await this.announcementsService.resolveUsersByPermission(FINANCE_PERMISSIONS);
    if (recipients.length === 0) return;

    // Daily dedup so the user gets one nudge per day until they record it.
    const today = isoDay(new Date());
    await this.announcementsService.createSystemNotifications({
      userIds: recipients,
      title: 'Salary payments not yet recorded as expenses',
      message: `There are ${pendingCount} paid payroll(s) that haven't been recorded as Finance expenses yet. Open Payroll → "Mark as Expenses" to record them.`,
      type: 'payment',
      link: '/dashboard/payroll',
      dedupKey: `pending-salary-expenses:${today}`,
    });
  }
}
