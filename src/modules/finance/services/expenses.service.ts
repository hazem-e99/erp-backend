import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Expense, ExpenseDocument } from '../schemas/expense.schema';
import { CreateExpenseDto } from '../dto/create-expense.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { calculateBaseAmount } from '../validators/finance.validators';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
  ) {}

  async create(dto: CreateExpenseDto, attachmentUrl?: string): Promise<ExpenseDocument> {
    const baseAmount = calculateBaseAmount(dto.amount, dto.exchangeRate);
    
    const expense = new this.expenseModel({
      amount: dto.amount,
      currency: dto.currency,
      exchangeRate: dto.exchangeRate,
      baseAmount, // Converted to base currency
      category: dto.category,
      date: new Date(dto.date),
      description: dto.description,
      attachmentUrl: attachmentUrl ?? '',
    });
    return expense.save();
  }

  async findAll(query: PaginationQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (query.startDate) filter.date = { $gte: new Date(query.startDate) };
    if (query.endDate) {
      filter.date = { ...(filter.date || {}), $lte: new Date(query.endDate) };
    }

    const [data, total] = await Promise.all([
      this.expenseModel.find(filter).sort({ date: -1 }).skip(skip).limit(limit).lean(),
      this.expenseModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<ExpenseDocument> {
    const exp = await this.expenseModel.findById(id);
    if (!exp) throw new NotFoundException('Expense not found');
    return exp;
  }

  async delete(id: string): Promise<void> {
    await this.findOne(id);
    await this.expenseModel.findByIdAndDelete(id);
  }

  async getTotalExpenses(startDate?: Date, endDate?: Date): Promise<number> {
    const match: Record<string, any> = {};
    if (startDate || endDate) {
      match.date = {};
      if (startDate) match.date.$gte = startDate;
      if (endDate) match.date.$lte = endDate;
    }
    const result = await this.expenseModel.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount
    ]);
    return result[0]?.total ?? 0;
  }

  async getByCategory(startDate?: Date, endDate?: Date) {
    const match: Record<string, any> = {};
    if (startDate || endDate) {
      match.date = {};
      if (startDate) match.date.$gte = startDate;
      if (endDate) match.date.$lte = endDate;
    }
    return this.expenseModel.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$baseAmount' }, count: { $sum: 1 } } }, // Use baseAmount
      { $sort: { total: -1 } },
    ]);
  }

  async getMonthlyChart(year: number): Promise<Array<{ month: number; total: number }>> {
    const result = await this.expenseModel.aggregate([
      {
        $match: {
          date: {
            $gte: new Date(year, 0, 1),
            $lte: new Date(year, 11, 31, 23, 59, 59),
          },
        },
      },
      {
        $group: {
          _id: { month: { $month: '$date' } },
          total: { $sum: '$baseAmount' }, // Use baseAmount
        },
      },
    ]);

    const chart: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) chart[m] = 0;
    for (const r of result) chart[r._id.month] += r.total;
    return Object.entries(chart).map(([month, total]) => ({ month: Number(month), total }));
  }
}
