import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Revenue, RevenueDocument, RevenueStatus } from '../schemas/revenue.schema';
import { PaginationQueryDto } from '../dto/query.dto';
import { FinanceGateway } from '../finance.gateway';
import { getMonthDateRange } from '../validators/finance.validators';

@Injectable()
export class RevenueService {
  constructor(
    @InjectModel(Revenue.name) private revenueModel: Model<RevenueDocument>,
    private readonly gateway: FinanceGateway,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.clientId) filter.clientId = new Types.ObjectId(query.clientId);
    if (query.month && query.year) {
      const { start, end } = getMonthDateRange(query.month, query.year);
      filter.recognitionDate = { $gte: start, $lte: end };
    } else {
      if (query.startDate) filter.recognitionDate = { $gte: new Date(query.startDate) };
      if (query.endDate) {
        filter.recognitionDate = { ...(filter.recognitionDate || {}), $lte: new Date(query.endDate) };
      }
    }

    const [data, total] = await Promise.all([
      this.revenueModel
        .find(filter)
        .sort({ recognitionDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.revenueModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Revenue Recognition Engine — run daily.
   * Finds all revenue entries where recognitionDate <= today and status = pending.
   * Revenue is recognized regardless of installment payment status.
   */
  async runRecognitionJob(): Promise<number> {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const pending = await this.revenueModel.find({
      recognitionDate: { $lte: today },
      status: RevenueStatus.PENDING,
    });

    let count = 0;
    for (const rev of pending) {
      rev.status = RevenueStatus.RECOGNIZED;
      await rev.save();
      count++;
    }

    if (count > 0) {
      this.gateway.emitFinanceUpdate('revenue:recognized', { count });
    }
    return count;
  }

  async getMonthlyRecognized(year: number, month: number): Promise<number> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    const result = await this.revenueModel.aggregate([
      {
        $match: {
          recognitionDate: { $gte: start, $lte: end },
          status: RevenueStatus.RECOGNIZED,
        },
      },
      { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
    ]);
    return result[0]?.total ?? 0;
  }

  async getMonthlyChart(year: number): Promise<Array<{ month: number; recognized: number; pending: number }>> {
    const result = await this.revenueModel.aggregate([
      {
        $match: {
          recognitionDate: {
            $gte: new Date(year, 0, 1),
            $lte: new Date(year, 11, 31, 23, 59, 59),
          },
        },
      },
      {
        $group: {
          _id: {
            month: { $month: '$recognitionDate' },
            status: '$status',
          },
          total: { $sum: '$baseAmount' }, // Use baseAmount
        },
      },
    ]);

    const chart: Record<number, { recognized: number; pending: number }> = {};
    for (let m = 1; m <= 12; m++) {
      chart[m] = { recognized: 0, pending: 0 };
    }
    for (const r of result) {
      const m = r._id.month;
      if (r._id.status === RevenueStatus.RECOGNIZED) chart[m].recognized += r.total;
      else if (r._id.status === RevenueStatus.PENDING) chart[m].pending += r.total;
    }
    return Object.entries(chart).map(([month, v]) => ({
      month: Number(month),
      ...v,
    }));
  }

  async getTotalRecognized(startDate?: Date, endDate?: Date): Promise<number> {
    const match: Record<string, any> = { status: RevenueStatus.RECOGNIZED };
    if (startDate || endDate) {
      match.recognitionDate = {};
      if (startDate) match.recognitionDate.$gte = startDate;
      if (endDate) match.recognitionDate.$lte = endDate;
    }
    const result = await this.revenueModel.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
    ]);
    return result[0]?.total ?? 0;
  }
}
