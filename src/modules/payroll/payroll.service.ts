import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payroll, PayrollDocument } from './schemas/payroll.schema';
import {
  PayrollConfig,
  PayrollConfigDocument,
} from './schemas/payroll-config.schema';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { Expense, ExpenseDocument } from '../finance/schemas/expense.schema';
import {
  GeneratePayrollDto,
  UpdatePayrollDto,
  UpsertPayrollConfigDto,
} from './dto/payroll.dto';
import { calculateBaseAmount } from '../finance/validators/finance.validators';
import { BASE_CURRENCY } from '../finance/constants/currency.constants';
import {
  calculateCycleDates,
  calculateWorkedDays,
  SALARY_DAYS_PER_MONTH,
} from './utils/payroll-cycle.utils';

@Injectable()
export class PayrollService {
  constructor(
    @InjectModel(Payroll.name) private payrollModel: Model<PayrollDocument>,
    @InjectModel(PayrollConfig.name)
    private configModel: Model<PayrollConfigDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
  ) {}

  /** Retrieve the singleton payroll config, creating it with defaults if absent. */
  async getConfig(): Promise<PayrollConfigDocument> {
    let config = await this.configModel.findOne();
    if (!config) {
      config = await this.configModel.create({
        cycleStartDay: 26,
        cycleEndDay: 25,
        paymentDay: 25,
      });
    }
    return config;
  }

  /** Update the payroll cycle config. */
  async upsertConfig(
    dto: UpsertPayrollConfigDto,
  ): Promise<PayrollConfigDocument> {
    let config = await this.configModel.findOne();
    if (!config) {
      config = await this.configModel.create({
        cycleStartDay: dto.cycleStartDay ?? 26,
        cycleEndDay: dto.cycleEndDay ?? 25,
        paymentDay: dto.paymentDay ?? 25,
      });
    } else {
      if (dto.cycleStartDay !== undefined)
        config.cycleStartDay = dto.cycleStartDay;
      if (dto.cycleEndDay !== undefined) config.cycleEndDay = dto.cycleEndDay;
      if (dto.paymentDay !== undefined) config.paymentDay = dto.paymentDay;
      await config.save();
    }
    return config;
  }

  async generate(dto: GeneratePayrollDto) {
    const employee = await this.employeeModel.findById(dto.employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    const existing = await this.payrollModel.findOne({
      employeeId: dto.employeeId,
      month: dto.month,
      year: dto.year,
    });
    if (existing)
      throw new ConflictException('Payroll already generated for this month');

    // ── Payroll Config & Cycle Dates ──────────────────────────────────────────
    const config = await this.getConfig();
    const { cycleStart, cycleEnd, paymentDate, totalCycleDays } =
      calculateCycleDates(
        dto.month,
        dto.year,
        config.cycleStartDay,
        config.cycleEndDay,
        config.paymentDay,
      );

    // ── Proration ─────────────────────────────────────────────────────────────
    const joinDate = employee.dateOfJoining ?? new Date(Date.UTC(2000, 0, 1));
    const terminationDate: Date | null =
      (employee as any).terminationDate ?? null;

    const { workedDays, isProrated } = calculateWorkedDays(
      cycleStart,
      cycleEnd,
      joinDate,
      terminationDate,
    );

    const exchangeRate = employee.exchangeRate || 1;
    const currency = employee.currency || BASE_CURRENCY;
    const baseSalary = employee.baseSalary;

    // dailyRate = baseSalary / 30  (always 30, not calendar days)
    const dailyRate = parseFloat(
      (baseSalary / SALARY_DAYS_PER_MONTH).toFixed(4),
    );
    const proratedBaseSalary = parseFloat((dailyRate * workedDays).toFixed(2));
    const baseBaseSalary = calculateBaseAmount(baseSalary, exchangeRate);
    const baseProratedBaseSalary = parseFloat(
      (proratedBaseSalary * exchangeRate).toFixed(2),
    );

    // ── Optional components ───────────────────────────────────────────────────
    const bonuses = dto.bonuses ?? 0;
    const commissions = dto.commissions ?? 0;
    const deductions = dto.deductions ?? 0;
    const maxKpi = dto.maxKpi ?? employee.maxKpi ?? 0;
    const kpiPercentage = dto.kpiPercentage ?? 0;
    const kpiAmount = parseFloat(((maxKpi * kpiPercentage) / 100).toFixed(2));

    const baseBonuses = calculateBaseAmount(bonuses, exchangeRate);
    const baseCommissions = calculateBaseAmount(commissions, exchangeRate);
    const baseDeductions = calculateBaseAmount(deductions, exchangeRate);
    const baseMaxKpi = calculateBaseAmount(maxKpi, exchangeRate);
    const baseKpiAmount = calculateBaseAmount(kpiAmount, exchangeRate);

    // ── Net salary (always in base currency) ──────────────────────────────────
    const netSalary = parseFloat(
      (
        baseProratedBaseSalary +
        baseBonuses +
        baseCommissions -
        baseDeductions +
        baseKpiAmount
      ).toFixed(2),
    );

    // ── Breakdown ────────────────────────────────────────────────────────────
    const cycleStartStr = cycleStart.toISOString().split('T')[0];
    const cycleEndStr = new Date(
      Date.UTC(
        cycleEnd.getUTCFullYear(),
        cycleEnd.getUTCMonth(),
        cycleEnd.getUTCDate(),
      ),
    )
      .toISOString()
      .split('T')[0];

    const breakdown = {
      cycle: `${cycleStartStr} → ${cycleEndStr}`,
      baseSalary,
      dailyRate: parseFloat(dailyRate.toFixed(4)),
      workedDays: parseFloat(workedDays.toFixed(4)),
      totalCycleDays,
      isProrated,
      proratedBaseSalary,
      bonuses,
      commissions,
      manualDeductions: deductions,
      maxKpi,
      kpiPercentage,
      kpiAmount,
      netSalary,
    };

    try {
      return await this.payrollModel.create({
        employeeId: dto.employeeId,
        month: dto.month,
        year: dto.year,
        currency,
        exchangeRate,
        baseSalary,
        bonuses,
        commissions,
        deductions,
        maxKpi,
        kpiPercentage,
        kpiAmount,
        baseBaseSalary,
        baseBonuses,
        baseCommissions,
        baseDeductions,
        baseMaxKpi,
        baseKpiAmount,
        // Cycle fields
        cycleStart,
        cycleEnd,
        paymentDate,
        totalCycleDays,
        workedDays,
        dailyRate,
        proratedBaseSalary,
        baseProratedBaseSalary,
        isProrated,
        netSalary,
        status: 'draft',
        notes: dto.notes || '',
        breakdown,
      });
    } catch (err: any) {
      // Guard against race condition: two simultaneous generate() calls for same employee/month
      // both pass the pre-check above but hit the unique index on create → E11000
      if (err.code === 11000) {
        throw new ConflictException('Payroll already generated for this month');
      }
      throw err;
    }
  }

  async findAll(query: any = {}) {
    const {
      page = 1,
      limit = 20,
      month,
      year,
      status,
      employeeId,
      includeOrphans,
    } = query;
    const filter: any = {};
    if (month) filter.month = +month;
    if (year) filter.year = +year;
    if (status) filter.status = status;
    if (employeeId) filter.employeeId = employeeId;

    const total = await this.payrollModel.countDocuments(filter);
    let payrolls = await this.payrollModel
      .find(filter)
      .populate({
        path: 'employeeId',
        populate: { path: 'userId', select: 'name email avatar' },
      })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ year: -1, month: -1 });

    // Filter out orphan payrolls (employee was permanently deleted) unless
    // the caller explicitly asked to include them (e.g. for an audit view).
    const wantOrphans =
      includeOrphans === true ||
      includeOrphans === 'true' ||
      includeOrphans === '1';
    if (!wantOrphans) {
      payrolls = payrolls.filter((p: any) => p.employeeId != null);
    }

    return { data: payrolls, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const payroll = await this.payrollModel.findById(id).populate({
      path: 'employeeId',
      populate: { path: 'userId', select: 'name email avatar' },
    });
    if (!payroll) throw new NotFoundException('Payroll not found');
    return payroll;
  }

  async update(id: string, dto: UpdatePayrollDto) {
    const payroll = await this.payrollModel.findById(id);
    if (!payroll) throw new NotFoundException('Payroll not found');

    const exchangeRate = payroll.exchangeRate || 1;

    if (dto.bonuses !== undefined) {
      payroll.bonuses = dto.bonuses;
      payroll.baseBonuses = calculateBaseAmount(dto.bonuses, exchangeRate);
    }
    if (dto.commissions !== undefined) {
      payroll.commissions = dto.commissions;
      payroll.baseCommissions = calculateBaseAmount(
        dto.commissions,
        exchangeRate,
      );
    }
    if (dto.deductions !== undefined) {
      payroll.deductions = dto.deductions;
      payroll.baseDeductions = calculateBaseAmount(
        dto.deductions,
        exchangeRate,
      );
    }
    if (dto.maxKpi !== undefined) {
      payroll.maxKpi = dto.maxKpi;
      payroll.baseMaxKpi = calculateBaseAmount(dto.maxKpi, exchangeRate);
    }
    if (dto.kpiPercentage !== undefined) {
      payroll.kpiPercentage = dto.kpiPercentage;
    }
    if (dto.transferScreenshot !== undefined)
      payroll.transferScreenshot = dto.transferScreenshot;
    if (dto.transactionNumber !== undefined)
      payroll.transactionNumber = dto.transactionNumber;
    if (dto.status) {
      payroll.status = dto.status;
      if (dto.status === 'paid') {
        const now = new Date();
        payroll.paidAt = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
      }
    }
    if (dto.notes) payroll.notes = dto.notes;

    // Recalculate KPI amount (in original currency)
    payroll.kpiAmount = parseFloat(
      ((payroll.maxKpi * payroll.kpiPercentage) / 100).toFixed(2),
    );
    payroll.baseKpiAmount = calculateBaseAmount(
      payroll.kpiAmount,
      exchangeRate,
    );

    // Recalculate net salary
    // New-style payroll has cycleStart set; use baseProratedBaseSalary (may legitimately be 0).
    // Legacy payroll (cycleStart is null) falls back to full baseBaseSalary.
    const effectiveProratedBase =
      (payroll as any).cycleStart != null
        ? ((payroll as any).baseProratedBaseSalary ?? 0)
        : payroll.baseBaseSalary;
    payroll.netSalary = parseFloat(
      (
        effectiveProratedBase +
        payroll.baseBonuses +
        payroll.baseCommissions -
        payroll.baseDeductions +
        payroll.baseKpiAmount
      ).toFixed(2),
    );

    await payroll.save();

    // Sync breakdown snapshot so it stays consistent with updated fields.
    // breakdown is a Mixed type — Mongoose only detects writes to the top-level field.
    if (payroll.breakdown && typeof payroll.breakdown === 'object') {
      payroll.breakdown = {
        ...payroll.breakdown,
        bonuses: payroll.bonuses,
        commissions: payroll.commissions,
        manualDeductions: payroll.deductions,
        kpiPercentage: payroll.kpiPercentage,
        kpiAmount: payroll.kpiAmount,
        netSalary: payroll.netSalary,
      };
      payroll.markModified('breakdown');
      await payroll.save();
    }

    // Auto-sync the linked Finance expense (if any) so Finance totals stay in
    // step with payroll edits without requiring a manual "Update Expense".
    if (payroll.isRecordedAsExpense && payroll.expenseId) {
      await this.syncLinkedExpense(payroll.expenseId);
    }

    return payroll;
  }

  /**
   * Hard-delete a payroll record. If it was recorded as part of a Finance
   * expense, callers must pass `force = true`. The linked expense is then
   * re-synced from the remaining payrolls (or removed if it becomes empty).
   */
  async remove(
    id: string,
    force = false,
  ): Promise<{
    deleted: boolean;
    expenseSynced: boolean;
    expenseDeleted: boolean;
    expenseTotal?: number;
  }> {
    const payroll = await this.payrollModel.findById(id);
    if (!payroll) throw new NotFoundException('Payroll not found');

    const linkedExpenseId = payroll.expenseId;
    const wasRecorded = payroll.isRecordedAsExpense && !!linkedExpenseId;

    if (wasRecorded && !force) {
      throw new BadRequestException(
        'This payroll is recorded as a Finance expense. Pass force=true to detach and re-sync the expense.',
      );
    }

    await this.payrollModel.findByIdAndDelete(id);

    let expenseSynced = false;
    let expenseDeleted = false;
    let expenseTotal: number | undefined;

    if (wasRecorded && linkedExpenseId) {
      const result = await this.syncLinkedExpense(linkedExpenseId);
      expenseSynced = true;
      expenseDeleted = !result.expenseExists;
      expenseTotal = result.total;
    }

    return { deleted: true, expenseSynced, expenseDeleted, expenseTotal };
  }

  /**
   * Recalculate the linked salary Expense from the payrolls that currently
   * point to it. Used by both `update()` (auto-sync) and `updateExpense()`
   * (manual sync).
   *
   * If the expense no longer exists (deleted externally), it cleans up the
   * stale references on every payroll that was pointing to it so the UI does
   * not show "recorded as expense" against a phantom record.
   */
  private async syncLinkedExpense(
    expenseId: Types.ObjectId | string,
  ): Promise<{ total: number; count: number; expenseExists: boolean }> {
    const linkedPayrolls = await this.payrollModel.find({
      expenseId,
      isRecordedAsExpense: true,
    });

    const newTotal = parseFloat(
      linkedPayrolls.reduce((s, p) => s + (p.netSalary ?? 0), 0).toFixed(2),
    );

    // If there are no payrolls left pointing at this expense, delete it.
    if (linkedPayrolls.length === 0) {
      await this.expenseModel.findByIdAndDelete(expenseId);
      return { total: 0, count: 0, expenseExists: false };
    }

    const updated = await this.expenseModel.findByIdAndUpdate(
      expenseId,
      {
        amount: newTotal,
        baseAmount: newTotal,
        description: `Salary payments for ${linkedPayrolls.length} employee(s)`,
      },
      { new: true },
    );

    // Expense missing on disk — clean stale references so UI stops claiming
    // the payrolls are recorded.
    if (!updated) {
      await this.payrollModel.updateMany(
        { expenseId },
        { $set: { isRecordedAsExpense: false, expenseId: null } },
      );
      return { total: 0, count: linkedPayrolls.length, expenseExists: false };
    }

    return {
      total: newTotal,
      count: linkedPayrolls.length,
      expenseExists: true,
    };
  }

  async getPayslip(id: string) {
    const payroll = await this.payrollModel.findById(id).populate({
      path: 'employeeId',
      populate: { path: 'userId', select: 'name email' },
    });
    if (!payroll) throw new NotFoundException('Payroll not found');

    return {
      payslipId: payroll._id,
      employee: payroll.employeeId,
      period: `${payroll.month}/${payroll.year}`,
      cycleStart: payroll.cycleStart,
      cycleEnd: payroll.cycleEnd,
      paymentDate: payroll.paymentDate,
      baseSalary: payroll.baseSalary,
      dailyRate: payroll.dailyRate,
      workedDays: payroll.workedDays,
      totalCycleDays: payroll.totalCycleDays,
      isProrated: payroll.isProrated,
      proratedBaseSalary: payroll.proratedBaseSalary,
      bonuses: payroll.bonuses,
      commissions: payroll.commissions,
      deductions: payroll.deductions,
      kpiAmount: payroll.kpiAmount,
      netSalary: payroll.netSalary,
      currency: payroll.currency,
      exchangeRate: payroll.exchangeRate,
      breakdown: payroll.breakdown,
      status: payroll.status,
      paidAt: payroll.paidAt,
      generatedAt: (payroll as any).createdAt,
    };
  }

  async getMyPayroll(userId: string) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) throw new NotFoundException('Employee profile not found');
    return this.payrollModel
      .find({ employeeId: employee._id })
      .sort({ year: -1, month: -1 });
  }

  /**
   * Get total amount of paid payrolls not yet recorded as expenses
   */
  async getPendingExpensesAmount(): Promise<number> {
    const result = await this.payrollModel.aggregate([
      {
        $match: {
          status: 'paid',
          isRecordedAsExpense: false,
        },
      },
      // Drop payrolls whose employee no longer exists.
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeId',
          foreignField: '_id',
          as: 'employee',
        },
      },
      { $match: { 'employee.0': { $exists: true } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$netSalary' },
        },
      },
    ]);
    return result[0]?.total || 0;
  }

  /**
   * Mark all paid payrolls as expenses and create a single expense record
   */
  async markAsExpenses(
    month?: number,
    year?: number,
    expenseDate?: string,
  ): Promise<{ total: number; count: number; expense: any }> {
    const targetMonth = Number(month ?? new Date().getMonth() + 1);
    const targetYear = Number(year ?? new Date().getFullYear());

    // Find paid payrolls for the SELECTED month/year ONLY that are not yet recorded
    const pendingPayrolls = await this.payrollModel.find({
      status: 'paid',
      isRecordedAsExpense: false,
      month: targetMonth,
      year: targetYear,
    });

    if (pendingPayrolls.length === 0) {
      throw new NotFoundException(
        `No paid payrolls to record as expenses for ${targetMonth}/${targetYear}`,
      );
    }

    // Calculate total (netSalary is already in base currency)
    const totalBaseAmount = pendingPayrolls.reduce(
      (sum, p) => sum + p.netSalary,
      0,
    );

    // Use the provided expenseDate or default to today (UTC)
    let date = new Date();
    if (expenseDate) {
      // expenseDate is in format YYYY-MM-DD from the frontend date input
      const [year, month, day] = expenseDate.split('-').map(Number);
      date = new Date(Date.UTC(year, month - 1, day));
    } else {
      date = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      );
    }

    // Create expense record in base currency
    const expense = await this.expenseModel.create({
      amount: totalBaseAmount,
      currency: BASE_CURRENCY,
      exchangeRate: 1,
      baseAmount: totalBaseAmount,
      category: 'salaries',
      date: date,
      description: `Salary payments for ${pendingPayrolls.length} employee(s) in ${targetMonth}/${targetYear}`,
      attachmentUrl: '',
    });

    // Mark only the payrolls we processed as recorded and link the expense
    const payrollIds = pendingPayrolls.map((p) => p._id);
    await this.payrollModel.updateMany(
      { _id: { $in: payrollIds } },
      { $set: { isRecordedAsExpense: true, expenseId: expense._id } },
    );

    return {
      total: totalBaseAmount,
      count: pendingPayrolls.length,
      expense,
    };
  }

  /**
   * Mark paid payrolls for a single employee as one expense
   */
  async markAsExpenseForEmployee(
    employeeId: string,
    month?: number,
    year?: number,
    expenseDate?: string,
  ): Promise<{ total: number; count: number; expense: any }> {
    const targetMonth = Number(month ?? new Date().getMonth() + 1);
    const targetYear = Number(year ?? new Date().getFullYear());

    const employee = await this.employeeModel.findById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    const pendingPayrolls = await this.payrollModel.find({
      status: 'paid',
      isRecordedAsExpense: false,
      month: targetMonth,
      year: targetYear,
      employeeId: employee._id,
    });

    if (pendingPayrolls.length === 0) {
      throw new NotFoundException(
        `No paid payrolls to record for ${employee.name} in ${targetMonth}/${targetYear}`,
      );
    }

    const totalBaseAmount = pendingPayrolls.reduce(
      (sum, p) => sum + p.netSalary,
      0,
    );

    let date = new Date();
    if (expenseDate) {
      const [yearPart, monthPart, dayPart] = expenseDate.split('-').map(Number);
      date = new Date(Date.UTC(yearPart, monthPart - 1, dayPart));
    } else {
      date = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      );
    }

    const expense = await this.expenseModel.create({
      amount: totalBaseAmount,
      currency: BASE_CURRENCY,
      exchangeRate: 1,
      baseAmount: totalBaseAmount,
      category: 'salaries',
      date: date,
      description: `Salary payment for ${employee.name} (${employee.employeeId}) in ${targetMonth}/${targetYear}`,
      attachmentUrl: '',
    });

    const payrollIds = pendingPayrolls.map((p) => p._id);
    await this.payrollModel.updateMany(
      { _id: { $in: payrollIds } },
      { $set: { isRecordedAsExpense: true, expenseId: expense._id } },
    );

    return {
      total: totalBaseAmount,
      count: pendingPayrolls.length,
      expense,
    };
  }

  /**
   * Recalculate and update the salary expense record for a given month/year
   */
  async updateExpense(
    month: number,
    year: number,
  ): Promise<{ total: number; count: number }> {
    const recorded = await this.payrollModel.find({
      status: 'paid',
      isRecordedAsExpense: true,
      month,
      year,
    });

    if (recorded.length === 0) {
      throw new NotFoundException('No recorded expense found for this month');
    }

    const expenseId = recorded[0].expenseId;
    if (!expenseId) {
      throw new NotFoundException(
        'Expense record not linked — please re-mark as expenses',
      );
    }

    const { total, count, expenseExists } =
      await this.syncLinkedExpense(expenseId);
    if (!expenseExists) {
      throw new NotFoundException(
        'Linked expense no longer exists — payroll references have been cleaned',
      );
    }

    return { total, count };
  }

  /**
   * Delete the linked expense record and reset payrolls so they can be re-recorded in the correct month
   */
  async unlinkExpense(
    month: number,
    year: number,
  ): Promise<{ count: number; deletedExpenses: number }> {
    const targetMonth = Number(month);
    const targetYear = Number(year);

    const recorded = await this.payrollModel.find({
      status: 'paid',
      isRecordedAsExpense: true,
      month: targetMonth,
      year: targetYear,
    });

    if (recorded.length === 0) {
      throw new NotFoundException('No recorded expense found for this month');
    }

    let deletedCount = 0;

    // Use expenseId from the first recorded payroll as the linkage key.
    // All payrolls for the same month share a single expense record.
    const expenseId = recorded[0].expenseId;

    if (expenseId) {
      // Preferred path: delete the specific linked expense
      const deleted = await this.expenseModel.findByIdAndDelete(expenseId);
      if (deleted) deletedCount = 1;
    } else {
      // Fallback: scope the delete tightly to this month/year to avoid cross-month data loss
      const result = await this.expenseModel.deleteMany({
        category: 'salaries',
        description: { $regex: `${targetMonth}/${targetYear}` },
      });
      deletedCount = result.deletedCount || 0;
    }

    await this.payrollModel.updateMany(
      {
        status: 'paid',
        isRecordedAsExpense: true,
        month: targetMonth,
        year: targetYear,
      },
      { $set: { isRecordedAsExpense: false, expenseId: null } },
    );

    return { count: recorded.length, deletedExpenses: deletedCount };
  }

  /**
   * Clean up all salary expenses — delete them all so they can be re-recorded correctly
   * This fixes cases where old expenses were recorded with wrong dates or counts
   */
  async cleanOldExpenses(): Promise<{ deletedCount: number }> {
    const result = await this.expenseModel.deleteMany({
      category: 'salaries',
    });

    // Reset all payrolls so they can be re-recorded
    await this.payrollModel.updateMany(
      { isRecordedAsExpense: true },
      { $set: { isRecordedAsExpense: false, expenseId: null } },
    );

    return { deletedCount: result.deletedCount || 0 };
  }
}
