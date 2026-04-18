import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Installment, InstallmentDocument, InstallmentStatus } from '../schemas/installment.schema';
import { PaginationQueryDto } from '../dto/query.dto';
import { FinanceGateway } from '../finance.gateway';

@Injectable()
export class InstallmentsService {
  constructor(
    @InjectModel(Installment.name) private installmentModel: Model<InstallmentDocument>,
    private readonly gateway: FinanceGateway,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.clientId) filter.clientId = new Types.ObjectId(query.clientId);

    const [data, total] = await Promise.all([
      this.installmentModel.find(filter).sort({ dueDate: 1 }).skip(skip).limit(limit).lean(),
      this.installmentModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  async findBySubscription(subscriptionId: string) {
    return this.installmentModel
      .find({ subscriptionId: new Types.ObjectId(subscriptionId) })
      .sort({ dueDate: 1 })
      .lean();
  }

  /**
   * Marks overdue installments (due_date < today, status = pending).
   * Called by scheduler daily.
   */
  async markOverdue(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueInstallments = await this.installmentModel.find({
      dueDate: { $lt: today },
      status: InstallmentStatus.PENDING,
    });

    let count = 0;
    for (const inst of overdueInstallments) {
      inst.status = InstallmentStatus.OVERDUE;
      await inst.save();
      count++;
      this.gateway.emitFinanceUpdate('installment:overdue', {
        installmentId: inst._id.toString(),
        clientName: inst.clientName,
        amount: inst.amount,
        dueDate: inst.dueDate,
      });
    }
    return count;
  }

  /**
   * Sends reminders for installments due in N days.
   */
  async getUpcomingDue(daysAhead: number): Promise<InstallmentDocument[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(today);
    target.setDate(today.getDate() + daysAhead);

    return this.installmentModel.find({
      dueDate: { $gte: today, $lte: target },
      status: { $in: [InstallmentStatus.PENDING] },
      reminderSent: false,
    });
  }

  async markReminderSent(id: string): Promise<void> {
    await this.installmentModel.findByIdAndUpdate(id, { $set: { reminderSent: true } });
  }

  async getOverdueCount(): Promise<number> {
    return this.installmentModel.countDocuments({ status: InstallmentStatus.OVERDUE });
  }

  async getOutstandingTotal(): Promise<number> {
    const result = await this.installmentModel.aggregate([
      { $match: { status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE] } } },
      {
        $group: {
          _id: null,
          total: { $sum: { $subtract: ['$amount', '$paidAmount'] } },
        },
      },
    ]);
    return result[0]?.total ?? 0;
  }
}
