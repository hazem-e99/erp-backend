import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import { join } from 'path';
import { Expense, ExpenseDocument } from '../schemas/expense.schema';
import { CreateExpenseDto } from '../dto/create-expense.dto';
import { UpdateExpenseDto } from '../dto/update-expense.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { calculateBaseAmount, getMonthDateRange } from '../validators/finance.validators';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
  ) {}

  /** Best-effort delete of a file referenced by `/uploads/...` URL. */
  private removeUploadedFile(attachmentUrl?: string | null): void {
    if (!attachmentUrl || !attachmentUrl.startsWith('/uploads/')) return;
    const absolutePath = join(process.cwd(), attachmentUrl);
    fs.unlink(absolutePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        this.logger.warn(`Failed to delete attachment ${absolutePath}: ${err.message}`);
      }
    });
  }

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
    const limit = Math.min(5000, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (query.month && query.year) {
      const { start, end } = getMonthDateRange(query.month, query.year);
      filter.date = { $gte: start, $lte: end };
    } else {
      if (query.startDate) filter.date = { $gte: new Date(query.startDate) };
      if (query.endDate) {
        filter.date = { ...(filter.date || {}), $lte: new Date(query.endDate) };
      }
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

  async update(
    id: string,
    dto: UpdateExpenseDto,
    newAttachmentUrl?: string,
  ): Promise<ExpenseDocument> {
    const expense = await this.findOne(id);
    const previousAttachment = expense.attachmentUrl;

    if (dto.amount !== undefined) expense.amount = dto.amount;
    if (dto.currency !== undefined) expense.currency = dto.currency;
    if (dto.exchangeRate !== undefined) expense.exchangeRate = dto.exchangeRate;
    if (dto.category !== undefined) expense.category = dto.category;
    if (dto.date !== undefined) expense.date = new Date(dto.date);
    if (dto.description !== undefined) expense.description = dto.description;

    // Recalculate baseAmount whenever amount or exchangeRate changes
    if (dto.amount !== undefined || dto.exchangeRate !== undefined) {
      expense.baseAmount = calculateBaseAmount(expense.amount, expense.exchangeRate);
    }

    if (newAttachmentUrl) {
      expense.attachmentUrl = newAttachmentUrl;
    }

    await expense.save();

    // Remove the old attachment from disk only after a successful save.
    if (newAttachmentUrl && previousAttachment && previousAttachment !== newAttachmentUrl) {
      this.removeUploadedFile(previousAttachment);
    }

    return expense;
  }

  async delete(id: string): Promise<void> {
    const expense = await this.findOne(id);
    this.removeUploadedFile(expense.attachmentUrl);
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
