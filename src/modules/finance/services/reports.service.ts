import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment, PaymentDocument } from '../schemas/payment.schema';
import { Expense, ExpenseDocument } from '../schemas/expense.schema';
import { Revenue, RevenueDocument, RevenueStatus } from '../schemas/revenue.schema';
import { Installment, InstallmentDocument, InstallmentStatus } from '../schemas/installment.schema';
import { Subscription, SubscriptionDocument, SubscriptionStatus } from '../schemas/subscription.schema';
import { ReportQueryDto } from '../dto/query.dto';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Revenue.name) private revenueModel: Model<RevenueDocument>,
    @InjectModel(Installment.name) private installmentModel: Model<InstallmentDocument>,
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  private getMonthDateRange(month: number, year: number): { start: Date; end: Date } {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { start, end };
  }

  private resolvePeriod(query: ReportQueryDto, mode: 'ytd' | 'all' = 'ytd'): { start: Date; end: Date } {
    if (query.month && query.year) {
      return this.getMonthDateRange(query.month, query.year);
    }

    if (query.startDate || query.endDate) {
      const start = query.startDate ? new Date(query.startDate) : new Date(2000, 0, 1);
      const end = query.endDate ? new Date(query.endDate) : new Date();
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    const now = new Date();
    if (mode === 'all') {
      return { start: new Date(2000, 0, 1), end: now };
    }

    return { start: new Date(now.getFullYear(), 0, 1), end: now };
  }

  async getCashFlow(query: ReportQueryDto) {
    const { start, end } = this.resolvePeriod(query, 'ytd');

    const [paymentsRaw, expensesRaw] = await Promise.all([
      this.paymentModel.aggregate([
        { $match: { paymentDate: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$paymentDate' } },
            cashIn: { $sum: '$baseAmount' }, // Use baseAmount
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.expenseModel.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
            cashOut: { $sum: '$baseAmount' }, // Use baseAmount
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const map: Record<string, { period: string; cashIn: number; cashOut: number; net: number }> = {};
    for (const p of paymentsRaw) {
      map[p._id] = { period: p._id, cashIn: p.cashIn, cashOut: 0, net: 0 };
    }
    for (const e of expensesRaw) {
      if (!map[e._id]) map[e._id] = { period: e._id, cashIn: 0, cashOut: 0, net: 0 };
      map[e._id].cashOut = e.cashOut;
    }
    for (const key of Object.keys(map)) {
      map[key].net = map[key].cashIn - map[key].cashOut;
    }

    return Object.values(map).sort((a, b) => a.period.localeCompare(b.period));
  }

  async getProfitLoss(query: ReportQueryDto) {
    const { start, end } = this.resolvePeriod(query, 'ytd');

    const [revenueResult, expenseResult] = await Promise.all([
      this.revenueModel.aggregate([
        {
          $match: {
            recognitionDate: { $gte: start, $lte: end },
            status: RevenueStatus.RECOGNIZED,
          },
        },
        { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
      ]),
      this.expenseModel.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
      ]),
    ]);

    const revenue = revenueResult[0]?.total ?? 0;
    const expenses = expenseResult[0]?.total ?? 0;
    const profit = revenue - expenses;
    const margin = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;

    return { revenue, expenses, profit, margin, startDate: start, endDate: end };
  }

  async getOutstandingPayments(query: ReportQueryDto = {}) {
    const filter: Record<string, any> = {
      status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE, InstallmentStatus.PARTIALLY_PAID] },
    };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search?.trim()) {
      filter.clientName = { $regex: query.search.trim(), $options: 'i' };
    }

    if (query.month && query.year) {
      const { start, end } = this.getMonthDateRange(query.month, query.year);
      filter.dueDate = { $gte: start, $lte: end };
    } else if (query.startDate || query.endDate) {
      const { start, end } = this.resolvePeriod(query, 'all');
      filter.dueDate = { $gte: start, $lte: end };
    }

    return this.installmentModel.find(filter).sort({ dueDate: 1 }).lean();
  }

  async getSubscriptionMetrics(query: ReportQueryDto = {}) {
    const { start, end } = this.resolvePeriod(query, 'all');
    const baseMatch = query.month || query.year || query.startDate || query.endDate
      ? { createdAt: { $gte: start, $lte: end } }
      : {};

    const [statusBreakdown, planBreakdown, revenueByPlan] = await Promise.all([
      this.subscriptionModel.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$baseTotalPrice' } } }, // Use baseTotalPrice
      ]),
      this.subscriptionModel.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$planType', count: { $sum: 1 }, total: { $sum: '$baseTotalPrice' } } }, // Use baseTotalPrice
      ]),
      this.subscriptionModel.aggregate([
        { $match: { ...baseMatch, status: SubscriptionStatus.ACTIVE } },
        { $group: { _id: '$planType', mrr: { $sum: '$baseTotalPrice' } } }, // Use baseTotalPrice
      ]),
    ]);

    return { statusBreakdown, planBreakdown, revenueByPlan };
  }

  async getDashboardSummary(query: ReportQueryDto = {}) {
    const { start, end } = this.resolvePeriod(query, 'ytd');

    const [
      totalCashIn,
      totalCashOut,
      monthlyRevenue,
      outstandingInstallments,
      activeSubscriptions,
      overdueCount,
      cashFlowMonthly,
    ] = await Promise.all([
      this.paymentModel.aggregate([
        { $match: { paymentDate: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
      ]),
      this.expenseModel.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
      ]),
      this.revenueModel.aggregate([
        {
          $match: {
            recognitionDate: { $gte: start, $lte: end },
            status: RevenueStatus.RECOGNIZED,
          },
        },
        { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
      ]),
      this.installmentModel.aggregate([
        { $match: { status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE] } } },
        {
          $group: {
            _id: null,
            total: { $sum: { $subtract: ['$baseAmount', '$paidAmount'] } }, // Use baseAmount
          },
        },
      ]),
      this.subscriptionModel.countDocuments({ status: SubscriptionStatus.ACTIVE }),
      this.installmentModel.countDocuments({ status: InstallmentStatus.OVERDUE }),
      this.getCashFlow({ startDate: start.toISOString(), endDate: end.toISOString() }),
    ]);

    const cashIn = totalCashIn[0]?.total ?? 0;
    const cashOut = totalCashOut[0]?.total ?? 0;

    return {
      totalCashIn: cashIn,
      totalCashOut: cashOut,
      netProfit: cashIn - cashOut,
      recognizedRevenueThisMonth: monthlyRevenue[0]?.total ?? 0,
      periodStart: start,
      periodEnd: end,
      outstandingPayments: outstandingInstallments[0]?.total ?? 0,
      activeSubscriptions,
      overdueCount,
      cashFlowChart: cashFlowMonthly,
    };
  }

  /**
   * Delete all finance data (subscriptions, installments, payments, revenue, expenses)
   * ⚠️ WARNING: This action is irreversible!
   */
  async deleteAllFinanceData() {
    const results = await Promise.all([
      this.subscriptionModel.deleteMany({}),
      this.installmentModel.deleteMany({}),
      this.paymentModel.deleteMany({}),
      this.revenueModel.deleteMany({}),
      this.expenseModel.deleteMany({}),
    ]);

    return {
      subscriptionsDeleted: results[0].deletedCount,
      installmentsDeleted: results[1].deletedCount,
      paymentsDeleted: results[2].deletedCount,
      revenueDeleted: results[3].deletedCount,
      expensesDeleted: results[4].deletedCount,
      totalDeleted: results.reduce((sum, r) => sum + r.deletedCount, 0),
    };
  }
}
