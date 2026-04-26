import { Injectable, BadRequestException, NotFoundException, Logger, PreconditionFailedException, PayloadTooLargeException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Readable } from 'stream';
import { addMonths } from 'date-fns';
import { Subscription, SubscriptionDocument, SubscriptionStatus, PlanType, InstallmentPlan } from '../schemas/subscription.schema';
import { Installment, InstallmentDocument, InstallmentStatus } from '../schemas/installment.schema';
import { Revenue, RevenueDocument, RevenueStatus } from '../schemas/revenue.schema';
import { CreateSubscriptionDto, InstallmentItemDto } from '../dto/create-subscription.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { FinanceGateway } from '../finance.gateway';
import { FinanceErrors } from '../finance.exceptions';
import { roundCents, calculateBaseAmount, getMonthDateRange } from '../validators/finance.validators';
import { GoogleDriveStorage } from '../../backup/storage/google-drive.storage';

const ALLOWED_DOCUMENT_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
]);
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENTS_PER_SUBSCRIPTION = 10;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Installment.name) private installmentModel: Model<InstallmentDocument>,
    @InjectModel(Revenue.name) private revenueModel: Model<RevenueDocument>,
    private readonly gateway: FinanceGateway,
    private readonly googleDrive: GoogleDriveStorage,
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
   * Delete a subscription and all its installments, revenue entries, and Drive documents.
   * Drive deletion is best-effort — failures are logged but don't block the cascade.
   */
  async delete(id: string): Promise<void> {
    const subscription = await this.subscriptionModel.findById(id);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    for (const doc of subscription.documents ?? []) {
      try {
        await this.googleDrive.deleteFromSubscriptionDocs(doc.driveFileId);
      } catch (err: any) {
        this.logger.error(
          `Failed to delete Drive file ${doc.driveFileId} for subscription ${id}: ${err.message}`,
        );
      }
    }

    await this.installmentModel.deleteMany({ subscriptionId: id });
    await this.revenueModel.deleteMany({ subscriptionId: id });
    await this.subscriptionModel.findByIdAndDelete(id);
  }

  // ─── Documents ─────────────────────────────────────────────────────────────

  async listDocuments(subscriptionId: string) {
    const sub = await this.subscriptionModel.findById(subscriptionId).lean();
    if (!sub) throw new NotFoundException('Subscription not found');
    return (sub.documents ?? []).map((d: any) => ({
      _id: d._id?.toString(),
      originalName: d.originalName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
    }));
  }

  async addDocuments(
    subscriptionId: string,
    files: Express.Multer.File[],
    uploadedBy: string | null,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    if (!(await this.googleDrive.isConfigured())) {
      throw new PreconditionFailedException(
        'Google Drive is not connected. Connect it in Settings → Backup before uploading documents.',
      );
    }

    const sub = await this.subscriptionModel.findById(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found');

    const existingCount = sub.documents?.length ?? 0;
    if (existingCount + files.length > MAX_DOCUMENTS_PER_SUBSCRIPTION) {
      throw new BadRequestException(
        `A subscription can have at most ${MAX_DOCUMENTS_PER_SUBSCRIPTION} documents (current: ${existingCount}, attempted to add: ${files.length})`,
      );
    }

    for (const f of files) {
      if (!ALLOWED_DOCUMENT_MIME.has(f.mimetype)) {
        throw new BadRequestException(
          `File type not allowed: ${f.originalname} (${f.mimetype})`,
        );
      }
      if (f.size > MAX_DOCUMENT_BYTES) {
        throw new PayloadTooLargeException(
          `File ${f.originalname} exceeds the 20 MB limit`,
        );
      }
    }

    // Upload in parallel; if any fail, best-effort delete the ones that succeeded.
    const uploadResults = await Promise.allSettled(
      files.map(async (f) => {
        const uniqueName = `${subscriptionId}-${Date.now()}-${Math.round(Math.random() * 1e9)}-${f.originalname}`;
        const result = await this.googleDrive.uploadToSubscriptionDocs(
          Readable.from(f.buffer),
          uniqueName,
          f.mimetype,
        );
        return {
          driveFileId: result.remoteKey,
          originalName: f.originalname,
          mimeType: f.mimetype,
          sizeBytes: result.sizeBytes || f.size,
          uploadedAt: new Date(),
          uploadedBy,
        };
      }),
    );

    const succeeded = uploadResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value);
    const failures = uploadResults.filter((r) => r.status === 'rejected');

    if (failures.length > 0) {
      // Roll back the successful uploads so the user can retry cleanly
      await Promise.all(
        succeeded.map((d) =>
          this.googleDrive
            .deleteFromSubscriptionDocs(d.driveFileId)
            .catch((err) => this.logger.error(`Rollback delete failed: ${err.message}`)),
        ),
      );
      const reason = (failures[0] as PromiseRejectedResult).reason;
      throw new BadRequestException(
        `Failed to upload one or more documents: ${reason?.message ?? 'unknown error'}`,
      );
    }

    sub.documents.push(...succeeded);
    await sub.save();

    return {
      added: succeeded.length,
      documents: sub.documents.map((d: any) => ({
        _id: d._id?.toString(),
        originalName: d.originalName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        uploadedAt: d.uploadedAt,
      })),
    };
  }

  async streamDocument(subscriptionId: string, docId: string) {
    const sub = await this.subscriptionModel.findById(subscriptionId).lean();
    if (!sub) throw new NotFoundException('Subscription not found');
    const doc = (sub.documents ?? []).find((d: any) => d._id?.toString() === docId);
    if (!doc) throw new NotFoundException('Document not found');

    const stream = await this.googleDrive.downloadFromSubscriptionDocs(doc.driveFileId);
    return {
      stream,
      mimeType: doc.mimeType,
      originalName: doc.originalName,
      sizeBytes: doc.sizeBytes,
    };
  }

  async removeDocument(subscriptionId: string, docId: string): Promise<void> {
    const sub = await this.subscriptionModel.findById(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found');
    const doc = sub.documents.find((d: any) => d._id?.toString() === docId);
    if (!doc) throw new NotFoundException('Document not found');

    try {
      await this.googleDrive.deleteFromSubscriptionDocs(doc.driveFileId);
    } catch (err: any) {
      this.logger.error(`Drive delete failed for ${doc.driveFileId}: ${err.message}`);
      // Continue and remove the metadata anyway — the file is already orphaned in Drive
      // and we don't want the user stuck with a stale row they can't delete.
    }

    await this.subscriptionModel.updateOne(
      { _id: subscriptionId },
      { $pull: { documents: { _id: new Types.ObjectId(docId) } } },
    );
  }
}
