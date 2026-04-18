import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { addMonths, addDays } from 'date-fns';
import { Subscription, SubscriptionDocument, SubscriptionStatus, PlanType, InstallmentPlan } from '../schemas/subscription.schema';
import { Installment, InstallmentDocument, InstallmentStatus } from '../schemas/installment.schema';
import { Revenue, RevenueDocument, RevenueStatus } from '../schemas/revenue.schema';
import { CreateSubscriptionDto, InstallmentItemDto } from '../dto/create-subscription.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { FinanceGateway } from '../finance.gateway';

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
        throw new BadRequestException('installmentItems is required for this payment plan');
      }
      if (dto.installmentPlan === InstallmentPlan.SPLIT_2 && dto.installmentItems.length !== 2) {
        throw new BadRequestException('Split payment plan requires exactly 2 installment items');
      }
      // Derive totalPrice from items
      dto.totalPrice = parseFloat(
        dto.installmentItems.reduce((s, item) => s + item.amount, 0).toFixed(2),
      );
    } else if (!dto.totalPrice) {
      throw new BadRequestException('totalPrice is required for full payment plan');
    }

    const startDate = new Date(dto.startDate);
    const endDate = this.calcEndDate(startDate, dto.planType as PlanType);
    const months = this.planMonths(dto.planType as PlanType);
    const monthlyRevenue = parseFloat((dto.totalPrice! / months).toFixed(2));

    // Create subscription
    const sub = new this.subscriptionModel({
      clientId: new Types.ObjectId(dto.clientId),
      clientName: dto.clientName,
      planType: dto.planType,
      totalPrice: dto.totalPrice,
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
      // Adjust last entry for rounding difference
      const amt = i === months - 1
        ? parseFloat((dto.totalPrice - monthlyRevenue * (months - 1)).toFixed(2))
        : monthlyRevenue;
      revenueEntries.push({
        subscriptionId: sub._id,
        clientId: new Types.ObjectId(dto.clientId),
        clientName: dto.clientName,
        amount: amt,
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
      amount: parseFloat(item.amount.toFixed(2)),
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

    const [data, total] = await Promise.all([
      this.subscriptionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.subscriptionModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<SubscriptionDocument> {
    const sub = await this.subscriptionModel.findById(id);
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async cancel(id: string, reason: string): Promise<SubscriptionDocument> {
    const sub = await this.findOne(id);
    if (sub.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Already cancelled');
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
}
