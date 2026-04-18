import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Installment, InstallmentDocument, InstallmentStatus } from '../schemas/installment.schema';
import { Subscription, SubscriptionDocument, SubscriptionStatus } from '../schemas/subscription.schema';
import { Payment, PaymentDocument } from '../schemas/payment.schema';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { FinanceGateway } from '../finance.gateway';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(Installment.name) private installmentModel: Model<InstallmentDocument>,
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
    private readonly gateway: FinanceGateway,
  ) {}

  /**
   * Core payment allocation engine.
   * Allocates payment to the specified installment (FIFO within subscription).
   * Handles partial and overpayments.
   * Uses findOneAndUpdate for atomic updates to prevent race conditions.
   */
  async create(dto: CreatePaymentDto): Promise<{ payment: PaymentDocument; overflow: number }> {
    const installment = await this.installmentModel.findById(dto.installmentId);
    if (!installment) throw new NotFoundException('Installment not found');
    if (installment.status === InstallmentStatus.PAID) {
      throw new BadRequestException('Installment already fully paid');
    }

    const remaining = installment.amount - installment.paidAmount;
    const applied = Math.min(dto.amount, remaining);
    const overflow = parseFloat((dto.amount - applied).toFixed(2));
    const newPaidAmount = parseFloat((installment.paidAmount + applied).toFixed(2));
    const newStatus =
      newPaidAmount >= installment.amount
        ? InstallmentStatus.PAID
        : InstallmentStatus.PARTIALLY_PAID;

    // Atomic installment update
    const updatedInstallment = await this.installmentModel.findOneAndUpdate(
      { _id: installment._id, status: { $ne: InstallmentStatus.PAID } },
      {
        $set: {
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: newStatus === InstallmentStatus.PAID ? new Date() : installment.paidAt,
        },
      },
      { new: true },
    );

    if (!updatedInstallment) {
      throw new BadRequestException('Payment conflict: installment was updated concurrently');
    }

    // Create payment record
    const payment = new this.paymentModel({
      subscriptionId: new Types.ObjectId(dto.subscriptionId),
      installmentId: new Types.ObjectId(dto.installmentId),
      clientId: new Types.ObjectId(dto.clientId),
      clientName: dto.clientName,
      amount: applied,
      paymentDate: new Date(dto.paymentDate),
      method: dto.method,
      reference: dto.reference ?? '',
      notes: dto.notes ?? '',
      overpaymentAmount: overflow,
    });
    await payment.save();

    // Update subscription paidAmount + activate if first payment
    await this.subscriptionModel.findByIdAndUpdate(dto.subscriptionId, {
      $inc: { paidAmount: applied },
    });

    const subscription = await this.subscriptionModel.findById(dto.subscriptionId);
    if (subscription && subscription.status === SubscriptionStatus.PENDING) {
      subscription.status = SubscriptionStatus.ACTIVE;
      await subscription.save();
    }

    // Auto-allocate overflow to next pending installment
    if (overflow > 0) {
      const nextInstallment = await this.installmentModel
        .findOne({
          subscriptionId: new Types.ObjectId(dto.subscriptionId),
          status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE] },
        })
        .sort({ dueDate: 1 });

      if (nextInstallment) {
        await this.create({
          ...dto,
          installmentId: nextInstallment._id.toString(),
          amount: overflow,
          notes: `Overflow from previous payment`,
        });
      }
    }

    this.gateway.emitFinanceUpdate('payment:created', {
      paymentId: payment._id.toString(),
      subscriptionId: dto.subscriptionId,
      amount: applied,
    });

    return { payment, overflow };
  }

  async findAll(query: PaginationQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (query.clientId) filter.clientId = new Types.ObjectId(query.clientId);
    if (query.startDate) filter.paymentDate = { $gte: new Date(query.startDate) };
    if (query.endDate) {
      filter.paymentDate = { ...(filter.paymentDate || {}), $lte: new Date(query.endDate) };
    }

    const [data, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .sort({ paymentDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.paymentModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  async getTotalCashIn(startDate?: Date, endDate?: Date): Promise<number> {
    const match: Record<string, any> = {};
    if (startDate || endDate) {
      match.paymentDate = {};
      if (startDate) match.paymentDate.$gte = startDate;
      if (endDate) match.paymentDate.$lte = endDate;
    }
    const result = await this.paymentModel.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return result[0]?.total ?? 0;
  }
}
