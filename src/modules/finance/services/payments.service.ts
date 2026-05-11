import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Installment, InstallmentDocument, InstallmentStatus } from '../schemas/installment.schema';
import { Subscription, SubscriptionDocument, SubscriptionStatus } from '../schemas/subscription.schema';
import { Payment, PaymentDocument } from '../schemas/payment.schema';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { UpdatePaymentDto } from '../dto/update-payment.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { FinanceGateway } from '../finance.gateway';
import { FinanceErrors } from '../finance.exceptions';
import { calculateBaseAmount, getMonthDateRange } from '../validators/finance.validators';

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
   * 
   * CRITICAL: All allocation math uses baseAmount (in base currency EGP)
   */
  async create(dto: CreatePaymentDto): Promise<{ payment: PaymentDocument; overflow: number }> {
    const installment = await this.installmentModel.findById(dto.installmentId);
    if (!installment) throw FinanceErrors.INSTALLMENT_NOT_FOUND();
    if (installment.status === InstallmentStatus.PAID) {
      throw FinanceErrors.INSTALLMENT_ALREADY_PAID();
    }

    // Block payment on cancelled subscription
    const subscription = await this.subscriptionModel.findById(installment.subscriptionId);
    if (subscription?.status === SubscriptionStatus.CANCELLED) {
      throw FinanceErrors.INSTALLMENT_CANCELLED_SUB();
    }

    // Calculate base amount (payment amount converted to base currency)
    const paymentBaseAmount = calculateBaseAmount(dto.amount, dto.exchangeRate);

    // Installment's remaining balance is in base currency
    const remaining = installment.baseAmount - installment.paidAmount;
    const appliedBase = Math.min(paymentBaseAmount, remaining);
    const overflowBase = parseFloat((paymentBaseAmount - appliedBase).toFixed(2));
    const newPaidAmount = parseFloat((installment.paidAmount + appliedBase).toFixed(2));
    const newStatus =
      newPaidAmount >= installment.baseAmount
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
      throw FinanceErrors.PAYMENT_CONFLICT();
    }

    // Gate fees: deducted from incoming amount (customer pays full amount)
    const gateFeePercentage = dto.gateFeePercentage ?? 0;
    const gateFeeAmount = parseFloat(((dto.amount * gateFeePercentage) / 100).toFixed(2));
    const baseGateFeeAmount = parseFloat(((paymentBaseAmount * gateFeePercentage) / 100).toFixed(2));
    const baseNetAmount = parseFloat((paymentBaseAmount - baseGateFeeAmount).toFixed(2));

    // Create payment record
    const payment = new this.paymentModel({
      subscriptionId: new Types.ObjectId(dto.subscriptionId),
      installmentId: new Types.ObjectId(dto.installmentId),
      clientId: new Types.ObjectId(dto.clientId),
      clientName: dto.clientName,
      amount: dto.amount, // Original amount in original currency
      currency: dto.currency,
      exchangeRate: dto.exchangeRate,
      baseAmount: paymentBaseAmount, // Converted to base currency
      paymentDate: new Date(dto.paymentDate),
      method: dto.method,
      reference: dto.reference ?? '',
      notes: dto.notes ?? '',
      overpaymentAmount: overflowBase, // Overflow in base currency
      gateFeePercentage,
      gateFeeAmount,
      baseGateFeeAmount,
      baseNetAmount,
    });
    await payment.save();

    // Update subscription paidAmount + activate if first payment (uses base amount)
    await this.subscriptionModel.findByIdAndUpdate(dto.subscriptionId, {
      $inc: { paidAmount: appliedBase },
    });

    // Re-fetch subscription (subscription was fetched above)
    if (subscription && subscription.status === SubscriptionStatus.PENDING) {
      subscription.status = SubscriptionStatus.ACTIVE;
      await subscription.save();
    }

    // Auto-allocate overflow to next pending installment
    if (overflowBase > 0) {
      const nextInstallment = await this.installmentModel
        .findOne({
          subscriptionId: new Types.ObjectId(dto.subscriptionId),
          status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE] },
        })
        .sort({ dueDate: 1 });

      if (nextInstallment) {
        // Convert overflow back to original currency for the recursive call
        const overflowInOriginalCurrency = parseFloat((overflowBase / dto.exchangeRate).toFixed(2));
        await this.create({
          ...dto,
          installmentId: nextInstallment._id.toString(),
          amount: overflowInOriginalCurrency,
          notes: `Overflow from previous payment`,
        });
      }
    }

    this.gateway.emitFinanceUpdate('payment:created', {
      paymentId: payment._id.toString(),
      subscriptionId: dto.subscriptionId,
      amount: appliedBase, // Emit base amount for consistency
    });

    return { payment, overflow: overflowBase };
  }

  async findAll(query: PaginationQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (query.clientId) filter.clientId = new Types.ObjectId(query.clientId);
    if (query.month && query.year) {
      const { start, end } = getMonthDateRange(query.month, query.year);
      filter.paymentDate = { $gte: start, $lte: end };
    } else {
      if (query.startDate) filter.paymentDate = { $gte: new Date(query.startDate) };
      if (query.endDate) {
        filter.paymentDate = { ...(filter.paymentDate || {}), $lte: new Date(query.endDate) };
      }
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

  async findOne(id: string): Promise<PaymentDocument> {
    const payment = await this.paymentModel.findById(id);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /**
   * Update metadata fields only — amount/installment changes are NOT supported
   * because they require unwinding the recursive overflow allocation. To change
   * a payment's amount, delete it and create a new one.
   */
  async update(id: string, dto: UpdatePaymentDto): Promise<PaymentDocument> {
    const payment = await this.findOne(id);

    if (dto.paymentDate !== undefined) payment.paymentDate = new Date(dto.paymentDate);
    if (dto.method !== undefined) payment.method = dto.method;
    if (dto.reference !== undefined) payment.reference = dto.reference;
    if (dto.notes !== undefined) payment.notes = dto.notes;

    if (dto.gateFeePercentage !== undefined) {
      const pct = dto.gateFeePercentage;
      payment.gateFeePercentage = pct;
      payment.gateFeeAmount = parseFloat(((payment.amount * pct) / 100).toFixed(2));
      payment.baseGateFeeAmount = parseFloat(((payment.baseAmount * pct) / 100).toFixed(2));
      payment.baseNetAmount = parseFloat((payment.baseAmount - payment.baseGateFeeAmount).toFixed(2));
    }

    await payment.save();
    this.gateway.emitFinanceUpdate('payment:updated', { paymentId: payment._id.toString() });
    return payment;
  }

  /**
   * Delete a payment and recompute the affected installment + subscription state
   * from the remaining payments. Recomputation guarantees the final state stays
   * consistent regardless of how the payment originally allocated overflow.
   */
  async delete(id: string): Promise<void> {
    const payment = await this.findOne(id);
    const subscriptionId = payment.subscriptionId;

    await this.paymentModel.findByIdAndDelete(id);

    // Recompute every installment of this subscription from the surviving payments.
    const installments = await this.installmentModel
      .find({ subscriptionId })
      .sort({ dueDate: 1 });

    // Reset every installment, then re-apply remaining payments in payment-date order.
    for (const inst of installments) {
      inst.paidAmount = 0;
      inst.status = InstallmentStatus.PENDING;
      inst.paidAt = undefined as any;
    }

    const remainingPayments = await this.paymentModel
      .find({ subscriptionId })
      .sort({ paymentDate: 1, createdAt: 1 });

    for (const pay of remainingPayments) {
      const inst = installments.find((i) => i._id.equals(pay.installmentId));
      if (!inst) continue;
      const due = inst.baseAmount - inst.paidAmount;
      const applied = Math.min(pay.baseAmount, due);
      inst.paidAmount = parseFloat((inst.paidAmount + applied).toFixed(2));
      if (inst.paidAmount >= inst.baseAmount) {
        inst.status = InstallmentStatus.PAID;
        inst.paidAt = pay.paymentDate;
      } else if (inst.paidAmount > 0) {
        inst.status = InstallmentStatus.PARTIALLY_PAID;
      }
    }

    await Promise.all(installments.map((i) => i.save()));

    // Recompute subscription paidAmount + status
    const totalPaid = installments.reduce((s, i) => s + i.paidAmount, 0);
    const subscription = await this.subscriptionModel.findById(subscriptionId);
    if (subscription) {
      subscription.paidAmount = parseFloat(totalPaid.toFixed(2));
      // If no payments left and subscription was active because of payments, revert to pending.
      if (totalPaid === 0 && subscription.status === SubscriptionStatus.ACTIVE) {
        subscription.status = SubscriptionStatus.PENDING;
      }
      // If the subscription was completed and we removed payments below the total, reactivate it.
      if (totalPaid < subscription.baseTotalPrice && subscription.status === SubscriptionStatus.COMPLETED) {
        subscription.status = SubscriptionStatus.ACTIVE;
      }
      await subscription.save();
    }

    this.gateway.emitFinanceUpdate('payment:deleted', {
      paymentId: id,
      subscriptionId: subscriptionId.toString(),
    });
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
      { $group: { _id: null, total: { $sum: '$baseAmount' } } }, // Use baseAmount for aggregation
    ]);
    return result[0]?.total ?? 0;
  }
}
