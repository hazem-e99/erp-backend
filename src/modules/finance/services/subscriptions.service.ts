import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { addMonths } from 'date-fns';
import { Subscription, SubscriptionDocument, SubscriptionStatus, PlanType, InstallmentPlan } from '../schemas/subscription.schema';
import { Installment, InstallmentDocument, InstallmentStatus } from '../schemas/installment.schema';
import { Revenue, RevenueDocument, RevenueStatus } from '../schemas/revenue.schema';
import { CreateSubscriptionDto, InstallmentItemDto } from '../dto/create-subscription.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { FinanceGateway } from '../finance.gateway';
import { FinanceErrors } from '../finance.exceptions';
import { roundCents, calculateBaseAmount, getMonthDateRange } from '../validators/finance.validators';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Installment.name) private installmentModel: Model<InstallmentDocument>,
    @InjectModel(Revenue.name) private revenueModel: Model<RevenueDocument>,
    private readonly gateway: FinanceGateway,
  ) {}

  /**
   * Calculates end date based on plan type and start date.
   */
  private calcEndDate(start: Date, planType: PlanType): Date {
    switch (planType) {
      case PlanType.MONTHLY:     return addMonths(start, 1);
      case PlanType.QUARTERLY:   return addMonths(start, 3);
      case PlanType.SEMI_ANNUAL: return addMonths(start, 6);
      default: throw new BadRequestException(`Unknown plan type: ${planType}`);
    }
  }

  /**
   * Returns how many months (revenue entries) correspond to each plan.
   */
  private planMonths(planType: PlanType): number {
    switch (planType) {
      case PlanType.MONTHLY:     return 1;
      case PlanType.QUARTERLY:   return 3;
      case PlanType.SEMI_ANNUAL: return 6;
    }
  }

  /**
   * Creates subscription + installments + revenue schedule atomically.
   */
  async create(dto: CreateSubscriptionDto): Promise<SubscriptionDocument> {
    const needsItems =
      dto.installmentPlan === InstallmentPlan.SPLIT_2 ||
      dto.installmentPlan === InstallmentPlan.CUSTOM;

    if (needsItems) {
      if (!dto.installmentItems?.length) {
        throw FinanceErrors.SUBSCRIPTION_MISSING_ITEMS();
      }
      if (dto.installmentPlan === InstallmentPlan.SPLIT_2 && dto.installmentItems.length !== 2) {
        throw FinanceErrors.SUBSCRIPTION_SPLIT2_REQUIRES_2();
      }

      // Normalize each item amount (guard against client-side float artefacts)
      dto.installmentItems = dto.installmentItems.map((item) => ({
        ...item,
        amount: roundCents(item.amount),
      }));

      // Derive and validate total
      dto.totalPrice = roundCents(
        dto.installmentItems.reduce((s, item) => s + item.amount, 0),
      );

      if (dto.totalPrice <= 0) {
        throw FinanceErrors.SUBSCRIPTION_INVALID_TOTAL();
      }
      if (dto.totalPrice > 1_000_000) {
        throw new BadRequestException({
          message: 'Total subscription value cannot exceed 1,000,000',
          code: 'SUBSCRIPTION_TOTAL_TOO_LARGE',
        });
      }
    } else if (!dto.totalPrice) {
      throw new BadRequestException('totalPrice is required for full payment plan');
    } else {
      // Normalize full-plan price
      dto.totalPrice = roundCents(dto.totalPrice);
    }

    const startDate = new Date(dto.startDate);
    const endDate = this.calcEndDate(startDate, dto.planType as PlanType);
    const months = this.planMonths(dto.planType as PlanType);
    
    // Calculate base total price (converted to base currency)
    const baseTotalPrice = calculateBaseAmount(dto.totalPrice!, dto.exchangeRate);
    
    // Calculate monthly revenue in both currencies
    const monthlyRevenue = parseFloat((dto.totalPrice! / months).toFixed(2));
    const monthlyRevenueBase = parseFloat((baseTotalPrice / months).toFixed(2));

    // Create subscription
    const sub = new this.subscriptionModel({
      clientId: new Types.ObjectId(dto.clientId),
      clientName: dto.clientName,
      planType: dto.planType,
      totalPrice: dto.totalPrice,
      currency: dto.currency,
      exchangeRate: dto.exchangeRate,
      baseTotalPrice, // Converted to base currency
      startDate,
      endDate,
      installmentPlan: dto.installmentPlan,
      customInstallments: dto.installmentItems?.length ?? 0,
      description: dto.description,
      status: SubscriptionStatus.PENDING,
    });
    await sub.save();

    // Generate Revenue schedule
    const revenueEntries: Record<string, any>[] = [];
    for (let i = 0; i < months; i++) {
      const recognitionDate = addMonths(startDate, i);
      // Adjust last entry for rounding difference (both currencies)
      const amt = i === months - 1
        ? parseFloat((dto.totalPrice - monthlyRevenue * (months - 1)).toFixed(2))
        : monthlyRevenue;
      const amtBase = i === months - 1
        ? parseFloat((baseTotalPrice - monthlyRevenueBase * (months - 1)).toFixed(2))
        : monthlyRevenueBase;
      
      revenueEntries.push({
        subscriptionId: sub._id,
        clientId: new Types.ObjectId(dto.clientId),
        clientName: dto.clientName,
        amount: amt,
        currency: dto.currency,
        exchangeRate: dto.exchangeRate,
        baseAmount: amtBase, // Converted to base currency
        recognitionDate,
        status: RevenueStatus.PENDING,
        periodMonth: i + 1,
        description: `${dto.clientName} - ${dto.planType} plan - Month ${i + 1}`,
      });
    }
    await this.revenueModel.insertMany(revenueEntries);

    // Generate Installments
    await this.generateInstallments(sub, dto);

    this.gateway.emitFinanceUpdate('subscription:created', { subscriptionId: sub._id.toString() });
    return sub;
  }

  private async generateInstallments(
    sub: SubscriptionDocument,
    dto: CreateSubscriptionDto,
  ): Promise<void> {
    // FULL plan — single installment on start date
    if (dto.installmentPlan === InstallmentPlan.FULL) {
      await this.installmentModel.insertMany([{
        subscriptionId: sub._id,
        clientId: sub.clientId,
        clientName: sub.clientName,
        amount: sub.totalPrice,
        currency: dto.currency,
        exchangeRate: dto.exchangeRate,
        baseAmount: sub.baseTotalPrice, // Use subscription's baseTotalPrice
        paidAmount: 0,
        dueDate: new Date(dto.startDate),
        status: InstallmentStatus.PENDING,
        installmentNumber: 1,
        totalInstallments: 1,
      }]);
      return;
    }

    // SPLIT_2 or CUSTOM — each item has its own amount and dueDate
    const items = dto.installmentItems!;
    const installments: Record<string, any>[] = items.map((item, i) => ({
      subscriptionId: sub._id,
      clientId: sub.clientId,
      clientName: sub.clientName,
      amount: roundCents(item.amount),   // normalized original currency
      currency: dto.currency,
      exchangeRate: dto.exchangeRate,
      baseAmount: calculateBaseAmount(item.amount, dto.exchangeRate), // Converted to base
      paidAmount: 0,
      dueDate: new Date(item.dueDate),
      status: InstallmentStatus.PENDING,
      installmentNumber: i + 1,
      totalInstallments: items.length,
    }));
    await this.installmentModel.insertMany(installments);
  }

  async findAll(query: PaginationQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.clientId) filter.clientId = new Types.ObjectId(query.clientId);
    if (query.month && query.year) {
      const { start, end } = getMonthDateRange(query.month, query.year);
      filter.startDate = { $gte: start, $lte: end };
    } else {
      if (query.startDate) filter.startDate = { $gte: new Date(query.startDate) };
      if (query.endDate) {
        filter.startDate = { ...(filter.startDate || {}), $lte: new Date(query.endDate) };
      }
    }

    const [data, total] = await Promise.all([
      this.subscriptionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.subscriptionModel.countDocuments(filter),
    ]);

    // Enrich each subscription with installment counts (paid/total)
    const enrichedData = await Promise.all(
      data.map(async (sub) => {
        // Convert _id to ObjectId for proper matching
        const subscriptionId = new Types.ObjectId(sub._id);
        const installments = await this.installmentModel.find({ subscriptionId }).lean();
        const paidCount = installments.filter((i) => i.status === InstallmentStatus.PAID).length;
        const totalCount = installments.length;
        return {
          ...sub,
          paidInstallmentsCount: paidCount,
          totalInstallmentsCount: totalCount,
        };
      }),
    );

    return { data: enrichedData, total, page, limit };
  }

  async findOne(id: string): Promise<SubscriptionDocument> {
    const sub = await this.subscriptionModel.findById(id);
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async cancel(id: string, reason: string): Promise<SubscriptionDocument> {
    const sub = await this.findOne(id);
    if (sub.status === SubscriptionStatus.CANCELLED) {
      throw FinanceErrors.SUBSCRIPTION_ALREADY_CANCELLED();
    }
    if (sub.status === SubscriptionStatus.COMPLETED) {
      throw FinanceErrors.SUBSCRIPTION_COMPLETED_CANCEL();
    }

    sub.status = SubscriptionStatus.CANCELLED;
    sub.cancelledAt = new Date();
    sub.cancelReason = reason ?? '';
    await sub.save();

    // Cancel pending revenue entries
    await this.revenueModel.updateMany(
      { subscriptionId: sub._id, status: RevenueStatus.PENDING },
      { $set: { status: RevenueStatus.CANCELLED } },
    );

    this.gateway.emitFinanceUpdate('subscription:cancelled', { subscriptionId: id });
    return sub;
  }

  async getDashboardMetrics() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const [
      activeCount,
      pendingCount,
      completedCount,
      cancelledCount,
    ] = await Promise.all([
      this.subscriptionModel.countDocuments({ status: SubscriptionStatus.ACTIVE }),
      this.subscriptionModel.countDocuments({ status: SubscriptionStatus.PENDING }),
      this.subscriptionModel.countDocuments({ status: SubscriptionStatus.COMPLETED }),
      this.subscriptionModel.countDocuments({ status: SubscriptionStatus.CANCELLED }),
    ]);

    return { activeCount, pendingCount, completedCount, cancelledCount };
  }

  /**
   * Delete a subscription and all its installments and revenue entries
   */
  async delete(id: string): Promise<void> {
    const subscription = await this.subscriptionModel.findById(id);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Delete all installments for this subscription
    await this.installmentModel.deleteMany({ subscriptionId: id });

    // Delete all revenue entries for this subscription
    await this.revenueModel.deleteMany({ subscriptionId: id });

    // Delete the subscription itself
    await this.subscriptionModel.findByIdAndDelete(id);
  }
}
