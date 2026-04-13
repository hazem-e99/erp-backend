import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction, TransactionDocument } from './schemas/transaction.schema';
import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';

@Injectable()
export class FinanceService {
  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<TransactionDocument>,
  ) {}

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, type, category, startDate, endDate, projectId, clientId } = query;
    const filter: any = {};
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (projectId) filter.projectId = projectId;
    if (clientId) filter.clientId = clientId;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const total = await this.transactionModel.countDocuments(filter);
    const transactions = await this.transactionModel
      .find(filter)
      .populate('projectId', 'name')
      .populate('clientId', 'name company')
      .populate('createdBy', 'name email')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ date: -1 });
    return { data: transactions, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const transaction = await this.transactionModel
      .findById(id)
      .populate('projectId', 'name')
      .populate('clientId', 'name company')
      .populate('createdBy', 'name email');
    if (!transaction) throw new NotFoundException('Transaction not found');
    return transaction;
  }

  async create(dto: CreateTransactionDto, userId: string) {
    return this.transactionModel.create({ ...dto, createdBy: userId });
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const transaction = await this.transactionModel.findByIdAndUpdate(id, dto, { new: true });
    if (!transaction) throw new NotFoundException('Transaction not found');
    return transaction;
  }

  async delete(id: string) {
    const transaction = await this.transactionModel.findByIdAndDelete(id);
    if (!transaction) throw new NotFoundException('Transaction not found');
    return { message: 'Transaction deleted successfully' };
  }

  async getSummary(query: any = {}) {
    const { startDate, endDate, year, month } = query;
    const filter: any = { status: 'completed' };

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    } else if (year) {
      const m = month ? +month - 1 : 0;
      const start = month
        ? new Date(+year, m, 1)
        : new Date(+year, 0, 1);
      const end = month
        ? new Date(+year, m + 1, 0, 23, 59, 59)
        : new Date(+year, 11, 31, 23, 59, 59);
      filter.date = { $gte: start, $lte: end };
    }

    const income = await this.transactionModel.aggregate([
      { $match: { ...filter, type: 'income' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const expenses = await this.transactionModel.aggregate([
      { $match: { ...filter, type: 'expense' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const totalIncome = income[0]?.total || 0;
    const totalExpenses = expenses[0]?.total || 0;

    // Monthly breakdown
    const monthlyData = await this.transactionModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            month: { $month: '$date' },
            year: { $year: '$date' },
            type: '$type',
          },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Category breakdown
    const categoryBreakdown = await this.transactionModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { category: '$category', type: '$type' },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    return {
      totalIncome,
      totalExpenses,
      profit: totalIncome - totalExpenses,
      profitMargin: totalIncome > 0
        ? parseFloat(((totalIncome - totalExpenses) / totalIncome * 100).toFixed(2))
        : 0,
      monthlyData,
      categoryBreakdown,
    };
  }
}
