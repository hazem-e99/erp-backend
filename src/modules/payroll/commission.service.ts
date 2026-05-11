import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Commission,
  CommissionDocument,
  CommissionStatus,
  CommissionSourceType,
} from './schemas/commission.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { Expense, ExpenseDocument } from '../finance/schemas/expense.schema';
import { ApproveCommissionDto, CommissionsQueryDto } from './dto/commission.dto';
import { BASE_CURRENCY } from '../finance/constants/currency.constants';

interface CreateCommissionInput {
  employeeId: string | Types.ObjectId;
  employeeName: string;
  sourceType: CommissionSourceType;
  sourceId: string | Types.ObjectId;
  subscriptionId?: string | Types.ObjectId | null;
  clientId?: string | Types.ObjectId | null;
  clientName?: string;
  percentage: number;
  baseSourceNetAmount: number;
  currency?: string;
}

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(
    @InjectModel(Commission.name) private commissionModel: Model<CommissionDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
  ) {}

  /**
   * Create a single commission record. Used by the subscription create flow.
   */
  async createCommission(input: CreateCommissionInput): Promise<CommissionDocument> {
    const baseCommissionAmount = parseFloat(
      ((input.baseSourceNetAmount * input.percentage) / 100).toFixed(2),
    );

    return this.commissionModel.create({
      employeeId: new Types.ObjectId(String(input.employeeId)),
      employeeName: input.employeeName,
      sourceType: input.sourceType,
      sourceId: new Types.ObjectId(String(input.sourceId)),
      subscriptionId: input.subscriptionId ? new Types.ObjectId(String(input.subscriptionId)) : null,
      clientId: input.clientId ? new Types.ObjectId(String(input.clientId)) : null,
      clientName: input.clientName ?? '',
      percentage: input.percentage,
      baseSourceNetAmount: input.baseSourceNetAmount,
      baseCommissionAmount,
      currency: input.currency,
      status: CommissionStatus.PENDING,
    });
  }

  /**
   * Bulk create commissions for a subscription. Resolves employee names automatically.
   */
  async createForSubscription(params: {
    subscriptionId: Types.ObjectId | string;
    clientId: Types.ObjectId | string;
    clientName: string;
    baseSourceNetAmount: number;
    currency?: string;
    assignments: Array<{ employeeId: string; percentage: number }>;
  }): Promise<CommissionDocument[]> {
    if (!params.assignments?.length) return [];

    const employeeIds = params.assignments.map((a) => new Types.ObjectId(a.employeeId));
    const employees = await this.employeeModel
      .find({ _id: { $in: employeeIds } })
      .select('_id name')
      .lean();

    const empById = new Map(employees.map((e) => [String(e._id), e]));

    const docs = params.assignments.map((a) => {
      const emp = empById.get(a.employeeId);
      if (!emp) {
        throw new NotFoundException(`Employee not found: ${a.employeeId}`);
      }
      const baseCommissionAmount = parseFloat(
        ((params.baseSourceNetAmount * a.percentage) / 100).toFixed(2),
      );
      return {
        employeeId: emp._id,
        employeeName: emp.name,
        sourceType: CommissionSourceType.SUBSCRIPTION,
        sourceId: new Types.ObjectId(String(params.subscriptionId)),
        subscriptionId: new Types.ObjectId(String(params.subscriptionId)),
        clientId: new Types.ObjectId(String(params.clientId)),
        clientName: params.clientName,
        percentage: a.percentage,
        baseSourceNetAmount: params.baseSourceNetAmount,
        baseCommissionAmount,
        currency: params.currency,
        status: CommissionStatus.PENDING,
      };
    });

    return this.commissionModel.insertMany(docs as any) as any;
  }

  async findAll(query: CommissionsQueryDto) {
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.employeeId) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.month) filter.payrollMonth = Number(query.month);
    if (query.year) filter.payrollYear = Number(query.year);

    const data = await this.commissionModel.find(filter).sort({ createdAt: -1 }).lean();
    return { data, total: data.length };
  }

  async findById(id: string): Promise<CommissionDocument> {
    const c = await this.commissionModel.findById(id);
    if (!c) throw new NotFoundException('Commission not found');
    return c;
  }

  async approve(
    id: string,
    dto: ApproveCommissionDto,
    approverId: string | null,
    screenshotPath: string,
  ): Promise<CommissionDocument> {
    const commission = await this.commissionModel.findById(id);
    if (!commission) throw new NotFoundException('Commission not found');
    if (commission.status !== CommissionStatus.PENDING) {
      throw new BadRequestException(
        `Only pending commissions can be approved (current status: ${commission.status})`,
      );
    }

    // Create expense in the selected month (use middle of month as the date)
    const expenseDate = new Date(Date.UTC(dto.year, dto.month - 1, 15));
    const expense = await this.expenseModel.create({
      amount: commission.baseCommissionAmount,
      currency: BASE_CURRENCY,
      exchangeRate: 1,
      baseAmount: commission.baseCommissionAmount,
      category: 'commissions',
      date: expenseDate,
      description: `Commission for ${commission.employeeName}${commission.clientName ? ` (${commission.clientName})` : ''} — ${commission.percentage}% of ${commission.baseSourceNetAmount}`,
      attachmentUrl: screenshotPath,
    });

    commission.status = CommissionStatus.APPROVED;
    commission.payrollMonth = dto.month;
    commission.payrollYear = dto.year;
    commission.approvedAt = new Date();
    commission.approvedBy = approverId ? new Types.ObjectId(approverId) : null;
    commission.expenseId = expense._id as Types.ObjectId;
    commission.transferScreenshot = screenshotPath;
    if (dto.transactionNumber !== undefined) commission.transactionNumber = dto.transactionNumber;
    if (dto.notes !== undefined) commission.notes = dto.notes;
    await commission.save();
    return commission;
  }

  async cancel(id: string): Promise<CommissionDocument> {
    const commission = await this.commissionModel.findById(id);
    if (!commission) throw new NotFoundException('Commission not found');
    if (commission.status === CommissionStatus.PAID) {
      throw new BadRequestException('Cannot cancel a commission that has already been paid');
    }

    // If the commission was approved, remove its linked expense
    if (commission.expenseId) {
      try {
        await this.expenseModel.findByIdAndDelete(commission.expenseId);
      } catch (err: any) {
        this.logger.warn(`Failed to delete expense ${commission.expenseId} for commission ${id}: ${err.message}`);
      }
      commission.expenseId = null;
    }

    commission.status = CommissionStatus.CANCELLED;
    await commission.save();
    return commission;
  }

}
