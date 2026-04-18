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

  async getCashFlow(query: ReportQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = query.endDate ? new Date(query.endDate) : new Date();

    const [paymentsRaw, expensesRaw] = await Promise.all([
      this.paymentModel.aggregate([
        { $match: { paymentDate: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$paymentDate' } },
            cashIn: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.expenseModel.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
            cashOut: { $sum: '$amount' },
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
    const start = query.startDate ? new Date(query.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = query.endDate ? new Date(query.endDate) : new Date();

    const [revenueResult, expenseResult] = await Promise.all([
      this.revenueModel.aggregate([
        {
          $match: {
            recognitionDate: { $gte: start, $lte: end },
            status: RevenueStatus.RECOGNIZED,
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.expenseModel.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const revenue = revenueResult[0]?.total ?? 0;
    const expenses = expenseResult[0]?.total ?? 0;
    const profit = revenue - expenses;
    const margin = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;

    return { revenue, expenses, profit, margin, startDate: start, endDate: end };
  }

  async getOutstandingPayments() {
    return this.installmentModel
      .find({ status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE] } })
      .sort({ dueDate: 1 })
      .lean();
  }

  async getSubscriptionMetrics() {
    const [statusBreakdown, planBreakdown, revenueByPlan] = await Promise.all([
      this.subscriptionModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$totalPrice' } } },
      ]),
      this.subscriptionModel.aggregate([
        { $group: { _id: '$planType', count: { $sum: 1 }, total: { $sum: '$totalPrice' } } },
      ]),
      this.subscriptionModel.aggregate([
        { $match: { status: SubscriptionStatus.ACTIVE } },
        { $group: { _id: '$planType', mrr: { $sum: '$totalPrice' } } },
      ]),
    ]);

    return { statusBreakdown, planBreakdown, revenueByPlan };
  }

  async getDashboardSummary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const yearStart = new Date(now.getFullYear(), 0, 1);

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
        { $match: { paymentDate: { $gte: yearStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.expenseModel.aggregate([
        { $match: { date: { $gte: yearStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.revenueModel.aggregate([
        {
          $match: {
            recognitionDate: { $gte: monthStart, $lte: monthEnd },
            status: RevenueStatus.RECOGNIZED,
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.installmentModel.aggregate([
        { $match: { status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE] } } },
        {
          $group: {
            _id: null,
            total: { $sum: { $subtract: ['$amount', '$paidAmount'] } },
          },
        },
      ]),
      this.subscriptionModel.countDocuments({ status: SubscriptionStatus.ACTIVE }),
      this.installmentModel.countDocuments({ status: InstallmentStatus.OVERDUE }),
      this.getCashFlow({ startDate: yearStart.toISOString(), endDate: now.toISOString() }),
    ]);

    const cashIn = totalCashIn[0]?.total ?? 0;
    const cashOut = totalCashOut[0]?.total ?? 0;

    return {
      totalCashIn: cashIn,
      totalCashOut: cashOut,
      netProfit: cashIn - cashOut,
      recognizedRevenueThisMonth: monthlyRevenue[0]?.total ?? 0,
      outstandingPayments: outstandingInstallments[0]?.total ?? 0,
      activeSubscriptions,
      overdueCount,
      cashFlowChart: cashFlowMonthly,
    };
  }
}
