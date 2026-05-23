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
import {
  calculateBaseAmount,
  getMonthDateRange,
} from '../finance/validators/finance.validators';
import { BASE_CURRENCY } from '../finance/constants/currency.constants';
import {
  calculateCycleDates,
  calculateWorkedDays,
  SALARY_DAYS_PER_MONTH,
} from './utils/payroll-cycle.utils';

/**
 * Resolve the date a salary expense should be stamped with.
 *
 * Priority:
 *   1. Explicit `expenseDate` from the caller (frontend date picker).
 *   2. The cycle's `paymentDate` (so the expense lands inside the payroll
 *      month in Finance reports, regardless of when the operator clicked
 *      "Mark as Expenses").
 *   3. Last resort for legacy payrolls without `paymentDate`: the payroll's
 *      own (month, year) on day = paymentDay default (25). This keeps the
 *      expense inside the correct accounting month.
 */
function resolveExpenseDate(
  expenseDate: string | undefined,
  cyclePaymentDate: Date | null | undefined,
  fallbackMonth: number,
  fallbackYear: number,
): Date {
  if (expenseDate) {
    const [y, m, d] = expenseDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  if (cyclePaymentDate) {
    const pd = new Date(cyclePaymentDate);
    return new Date(
      Date.UTC(pd.getUTCFullYear(), pd.getUTCMonth(), pd.getUTCDate()),
    );
  }
  // Legacy payroll with no paymentDate — stamp it at the 25th of (month, year)
  // by default so it still falls inside the right accounting month.
  return new Date(Date.UTC(fallbackYear, fallbackMonth - 1, 25));
}

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
    // KPI is prorated with workedDays — a mid-cycle joiner shouldn't take a
    // full month's KPI while their base salary is already prorated.
    const kpiFraction =
      workedDays > 0
        ? Math.min(SALARY_DAYS_PER_MONTH, workedDays) / SALARY_DAYS_PER_MONTH
        : 0;
    const kpiAmount = parseFloat(
      (((maxKpi * kpiPercentage) / 100) * kpiFraction).toFixed(2),
    );

    const baseBonuses = calculateBaseAmount(bonuses, exchangeRate);
    const baseCommissions = calculateBaseAmount(commissions, exchangeRate);
    const baseDeductions = calculateBaseAmount(deductions, exchangeRate);
    const baseMaxKpi = calculateBaseAmount(maxKpi, exchangeRate);
    const baseKpiAmount = calculateBaseAmount(kpiAmount, exchangeRate);

    // ── Net salary (always in base currency) ──────────────────────────────────
    // Floor at 0 — over-deduction shouldn't roll into a negative expense.
    const rawNet =
      baseProratedBaseSalary +
      baseBonuses +
      baseCommissions -
      baseDeductions +
      baseKpiAmount;
    const netSalary = parseFloat(Math.max(0, rawNet).toFixed(2));

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

    // The payroll's recorded exchangeRate is *frozen at generation time*. We
    // never refresh it from the employee on update — otherwise a rate change
    // would silently rewrite history for an already-paid payroll.
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

    // ── Re-run proration when the payroll is not yet paid ────────────────────
    // A paid payroll is treated as immutable history: we never touch its
    // workedDays / proratedBaseSalary so a downstream change to
    // dateOfJoining or terminationDate cannot rewrite money that already
    // left the bank. Draft/processed payrolls *do* re-run so any HR fix
    // (joining date, last working day) is reflected before payment.
    if (
      payroll.status !== 'paid' &&
      (payroll as any).cycleStart &&
      (payroll as any).cycleEnd
    ) {
      const emp = await this.employeeModel.findById(payroll.employeeId);
      if (emp) {
        const joinDate =
          emp.dateOfJoining ?? new Date(Date.UTC(2000, 0, 1));
        const terminationDate: Date | null =
          (emp as any).terminationDate ?? null;

        const { workedDays, isProrated } = calculateWorkedDays(
          (payroll as any).cycleStart,
          (payroll as any).cycleEnd,
          joinDate,
          terminationDate,
        );

        const dailyRate = parseFloat(
          (payroll.baseSalary / SALARY_DAYS_PER_MONTH).toFixed(4),
        );
        const proratedBaseSalary = parseFloat(
          (dailyRate * workedDays).toFixed(2),
        );
        const baseProratedBaseSalary = parseFloat(
          (proratedBaseSalary * exchangeRate).toFixed(2),
        );

        (payroll as any).workedDays = parseFloat(workedDays.toFixed(4));
        (payroll as any).isProrated = isProrated;
        (payroll as any).dailyRate = dailyRate;
        (payroll as any).proratedBaseSalary = proratedBaseSalary;
        (payroll as any).baseProratedBaseSalary = baseProratedBaseSalary;
      }
    }

    // ── KPI amount: prorated by workedDays/30 ────────────────────────────────
    // A mid-cycle joiner shouldn't take a full month's KPI bonus while their
    // base salary is already prorated. We use the (now possibly refreshed)
    // workedDays from the payroll. For legacy payrolls without workedDays
    // we fall back to the full amount so old records stay stable.
    const workedDaysForKpi =
      (payroll as any).workedDays && (payroll as any).workedDays > 0
        ? Math.min(SALARY_DAYS_PER_MONTH, (payroll as any).workedDays)
        : SALARY_DAYS_PER_MONTH;
    const kpiFraction = workedDaysForKpi / SALARY_DAYS_PER_MONTH;

    payroll.kpiAmount = parseFloat(
      (((payroll.maxKpi * payroll.kpiPercentage) / 100) * kpiFraction).toFixed(2),
    );
    payroll.baseKpiAmount = calculateBaseAmount(
      payroll.kpiAmount,
      exchangeRate,
    );

    // ── Net salary ──────────────────────────────────────────────────────────
    // New-style payroll has cycleStart set; use baseProratedBaseSalary (may
    // legitimately be 0 — e.g. employee left before cycle start).
    // Legacy payroll (cycleStart is null) falls back to full baseBaseSalary.
    const effectiveProratedBase =
      (payroll as any).cycleStart != null
        ? ((payroll as any).baseProratedBaseSalary ?? 0)
        : payroll.baseBaseSalary;
    const rawNet =
      effectiveProratedBase +
      payroll.baseBonuses +
      payroll.baseCommissions -
      payroll.baseDeductions +
      payroll.baseKpiAmount;
    // Floor at 0 — over-deduction shouldn't roll into a negative expense.
    payroll.netSalary = parseFloat(Math.max(0, rawNet).toFixed(2));

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
        // Include the re-prorated values so the snapshot reflects the same
        // numbers the UI is rendering after an HR-driven joining-date fix.
        workedDays: parseFloat(((payroll as any).workedDays ?? 0).toFixed(4)),
        isProrated: (payroll as any).isProrated,
        proratedBaseSalary: (payroll as any).proratedBaseSalary,
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
   * Mark all paid payrolls as expenses and create a single expense record.
   *
   * IMPORTANT: orphan payrolls (employee was deleted) are *excluded* from
   * both the count and the total. The Payroll page in the UI hides them via
   * `findAll`, so including them here would create a Finance expense whose
   * value the operator never saw on screen — the very mismatch that produced
   * $107,526.66 in the button vs $109,510 in the expense doc. After the
   * skip we populate the employeeId to filter null refs out client-side
   * (the same trick `findAll` uses).
   */
  async markAsExpenses(
    month?: number,
    year?: number,
    expenseDate?: string,
  ): Promise<{ total: number; count: number; skippedOrphans: number; expense: any }> {
    const targetMonth = Number(month ?? new Date().getMonth() + 1);
    const targetYear = Number(year ?? new Date().getFullYear());

    // Find paid payrolls for the SELECTED month/year ONLY that are not yet recorded
    const allCandidates = await this.payrollModel
      .find({
        status: 'paid',
        isRecordedAsExpense: false,
        month: targetMonth,
        year: targetYear,
      })
      .populate({ path: 'employeeId', select: '_id' });

    // Drop orphans — payrolls whose employee was deleted. They show as null
    // after populate. Keeping them would inflate the expense.
    const pendingPayrolls = allCandidates.filter(
      (p: any) => p.employeeId != null,
    );
    const skippedOrphans = allCandidates.length - pendingPayrolls.length;

    if (pendingPayrolls.length === 0) {
      throw new NotFoundException(
        `No paid payrolls to record as expenses for ${targetMonth}/${targetYear}` +
          (skippedOrphans > 0
            ? ` (${skippedOrphans} orphan payroll(s) skipped — employee deleted)`
            : ''),
      );
    }

    // Calculate total (netSalary is already in base currency)
    const totalBaseAmount = pendingPayrolls.reduce(
      (sum, p) => sum + p.netSalary,
      0,
    );

    // Resolve the expense date:
    //   - explicit `expenseDate` from the caller wins.
    //   - otherwise use the cycle's `paymentDate` so the salary lands inside
    //     the payroll month in Finance reports (regardless of when the
    //     operator clicked the button).
    //   - last resort (legacy payrolls without `paymentDate`): today.
    const date = resolveExpenseDate(
      expenseDate,
      pendingPayrolls[0].paymentDate,
      targetMonth,
      targetYear,
    );

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
      skippedOrphans,
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

    const date = resolveExpenseDate(
      expenseDate,
      pendingPayrolls[0].paymentDate,
      targetMonth,
      targetYear,
    );

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
   * Compare every recorded salary expense (for a month or all months) against
   * the payrolls linked to it. Returns a per-expense breakdown so the UI can
   * flag drift and offer a one-click fix.
   *
   * "Drift" usually means an `update()`/`remove()` ran while `syncLinkedExpense`
   * could not complete (e.g. process restart) or pre-fix data from when the
   * sync wasn't wired up yet.
   */
  async getReconciliationStatus(
    month?: number,
    year?: number,
  ): Promise<{
    expenses: Array<{
      expenseId: string;
      month: number | null;
      year: number | null;
      expenseAmount: number;
      payrollSum: number;
      diff: number;
      payrollCount: number;
      orphanPayrolls: number;
      missingExpense: boolean;
    }>;
    totalDrift: number;
  }> {
    const expenseFilter: Record<string, any> = { category: 'salaries' };
    if (month && year) {
      const { start, end } = getMonthDateRange(month, year);
      expenseFilter.date = { $gte: start, $lte: end };
    }

    const expenses = await this.expenseModel.find(expenseFilter).lean();

    const breakdown: Array<{
      expenseId: string;
      month: number | null;
      year: number | null;
      expenseAmount: number;
      payrollSum: number;
      diff: number;
      payrollCount: number;
      orphanPayrolls: number;
      missingExpense: boolean;
    }> = [];

    let totalDrift = 0;

    for (const exp of expenses) {
      const payrolls = await this.payrollModel
        .find({ expenseId: exp._id, isRecordedAsExpense: true })
        .select('netSalary month year')
        .lean();

      const payrollSum = parseFloat(
        payrolls.reduce((s, p) => s + (p.netSalary ?? 0), 0).toFixed(2),
      );
      const diff = parseFloat((payrollSum - (exp.baseAmount ?? 0)).toFixed(2));

      // Detect "orphan" payrolls — pointing at an expense that no longer
      // exists. The find above already filters to live expenses, so we only
      // see them when we look at all expenseIds. Done in a separate sweep
      // below for the "all" case.

      breakdown.push({
        expenseId: exp._id.toString(),
        month: payrolls[0]?.month ?? null,
        year: payrolls[0]?.year ?? null,
        expenseAmount: exp.baseAmount ?? 0,
        payrollSum,
        diff,
        payrollCount: payrolls.length,
        orphanPayrolls: 0,
        missingExpense: false,
      });

      if (Math.abs(diff) > 0.01) totalDrift += Math.abs(diff);
    }

    // Sweep for payrolls flagged as recorded but pointing at a vanished
    // expense (the inverse drift). One row per unique expenseId.
    const ghostPayrolls = await this.payrollModel
      .aggregate([
        { $match: { isRecordedAsExpense: true, expenseId: { $ne: null } } },
        {
          $lookup: {
            from: 'expenses',
            localField: 'expenseId',
            foreignField: '_id',
            as: 'expense',
          },
        },
        { $match: { expense: { $size: 0 } } },
        {
          $group: {
            _id: '$expenseId',
            total: { $sum: '$netSalary' },
            count: { $sum: 1 },
            month: { $first: '$month' },
            year: { $first: '$year' },
          },
        },
      ])
      .exec();

    for (const ghost of ghostPayrolls) {
      breakdown.push({
        expenseId: ghost._id?.toString() ?? '',
        month: ghost.month ?? null,
        year: ghost.year ?? null,
        expenseAmount: 0,
        payrollSum: parseFloat((ghost.total ?? 0).toFixed(2)),
        diff: parseFloat((ghost.total ?? 0).toFixed(2)),
        payrollCount: ghost.count,
        orphanPayrolls: ghost.count,
        missingExpense: true,
      });
      totalDrift += Math.abs(ghost.total ?? 0);
    }

    return { expenses: breakdown, totalDrift: parseFloat(totalDrift.toFixed(2)) };
  }

  /**
   * Sum the *actual* salary expense documents that landed inside a payroll
   * month. We resolve the cycle's payment-date so a payroll generated in
   * May but paid on May 25 lands in the May bucket regardless of when the
   * operator clicked "Mark as Expenses".
   *
   * Why a backend endpoint? The Payroll page in the UI was previously
   * summing `netSalary` from the payrolls returned by `/payroll?month=…`,
   * which is the wrong source: it ignores cross-month linkage and drift in
   * the expense doc itself. This method returns what Finance actually sees.
   */
  async getRecordedExpenseTotalForMonth(
    month: number,
    year: number,
  ): Promise<{ total: number; expenseCount: number }> {
    const { start, end } = getMonthDateRange(month, year);
    const result = await this.expenseModel.aggregate([
      {
        $match: {
          category: 'salaries',
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$baseAmount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const row = result[0];
    return {
      total: parseFloat((row?.total ?? 0).toFixed(2)),
      expenseCount: row?.count ?? 0,
    };
  }

  /**
   * Deep debug dump for a single salary expense — returns the expense doc, every
   * payroll currently pointing at it (with employee name + netSalary), and an
   * explicit per-row diff so we can see *where* the drift comes from.
   */
  async debugExpenseBreakdown(expenseId: string) {
    const expense = await this.expenseModel.findById(expenseId).lean();
    if (!expense) throw new NotFoundException('Expense not found');

    const linkedPayrolls = await this.payrollModel
      .find({ expenseId: new Types.ObjectId(expenseId), isRecordedAsExpense: true })
      .populate({
        path: 'employeeId',
        select: 'name employeeId userId',
        populate: { path: 'userId', select: 'name' },
      })
      .lean();

    const rows = linkedPayrolls.map((p: any) => ({
      payrollId: p._id.toString(),
      employeeName: p.employeeId?.name || p.employeeId?.userId?.name || 'Unknown',
      employeeCode: p.employeeId?.employeeId ?? '',
      month: p.month,
      year: p.year,
      status: p.status,
      isProrated: p.isProrated,
      workedDays: p.workedDays,
      baseProratedBaseSalary: p.baseProratedBaseSalary,
      baseBonuses: p.baseBonuses,
      baseCommissions: p.baseCommissions,
      baseDeductions: p.baseDeductions,
      baseKpiAmount: p.baseKpiAmount,
      netSalary: p.netSalary,
      // What netSalary *should* equal given the stored components:
      computedNet: parseFloat(
        Math.max(
          0,
          (p.baseProratedBaseSalary ?? 0) +
            (p.baseBonuses ?? 0) +
            (p.baseCommissions ?? 0) -
            (p.baseDeductions ?? 0) +
            (p.baseKpiAmount ?? 0),
        ).toFixed(2),
      ),
    }));

    const sumOfNetSalaries = parseFloat(
      rows.reduce((s, r) => s + (r.netSalary ?? 0), 0).toFixed(2),
    );
    const sumOfComputedNets = parseFloat(
      rows.reduce((s, r) => s + r.computedNet, 0).toFixed(2),
    );

    return {
      expense: {
        _id: expense._id.toString(),
        baseAmount: expense.baseAmount,
        amount: expense.amount,
        category: expense.category,
        date: expense.date,
        description: expense.description,
      },
      payrollCount: rows.length,
      sumOfNetSalaries,
      sumOfComputedNets,
      diffExpenseVsNetSum: parseFloat(
        (sumOfNetSalaries - (expense.baseAmount ?? 0)).toFixed(2),
      ),
      diffNetVsComputed: parseFloat(
        (sumOfComputedNets - sumOfNetSalaries).toFixed(2),
      ),
      rows,
    };
  }

  /**
   * Force-resync every salary expense from its linked payrolls. Use after
   * `getReconciliationStatus` flags drift. Safe to run repeatedly.
   */
  async reconcileAllExpenses(): Promise<{
    fixed: number;
    deleted: number;
    cleanedGhosts: number;
  }> {
    let fixed = 0;
    let deleted = 0;

    const expenses = await this.expenseModel
      .find({ category: 'salaries' })
      .select('_id')
      .lean();

    for (const exp of expenses) {
      const result = await this.syncLinkedExpense(exp._id);
      if (!result.expenseExists) deleted += 1;
      else fixed += 1;
    }

    // Clean up payroll rows pointing at deleted expenses
    const ghostPayrolls = await this.payrollModel
      .aggregate([
        { $match: { isRecordedAsExpense: true, expenseId: { $ne: null } } },
        {
          $lookup: {
            from: 'expenses',
            localField: 'expenseId',
            foreignField: '_id',
            as: 'expense',
          },
        },
        { $match: { expense: { $size: 0 } } },
        { $project: { _id: 1 } },
      ])
      .exec();

    if (ghostPayrolls.length > 0) {
      await this.payrollModel.updateMany(
        { _id: { $in: ghostPayrolls.map((g) => g._id) } },
        { $set: { isRecordedAsExpense: false, expenseId: null } },
      );
    }

    return { fixed, deleted, cleanedGhosts: ghostPayrolls.length };
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
   * Clean up salary expenses. Pass `month`/`year` to limit the cleanup to a
   * single payroll month — otherwise every salary expense is removed.
   *
   * Scoping logic:
   *   1. Delete the salary expenses whose `date` falls inside the month range.
   *   2. Reset every payroll that linked to one of the deleted expenses so it
   *      can be re-recorded. If no month is supplied we reset every recorded
   *      payroll to match the legacy behaviour.
   */
  async cleanOldExpenses(
    month?: number,
    year?: number,
  ): Promise<{ deletedCount: number; resetPayrolls: number; scope: string }> {
    const filter: Record<string, any> = { category: 'salaries' };

    if (month && year) {
      const { start, end } = getMonthDateRange(month, year);
      filter.date = { $gte: start, $lte: end };
    }

    // Capture which expense IDs we're about to delete so we can detach the
    // exact payrolls that referenced them (rather than nuking every payroll).
    const expensesToDelete = await this.expenseModel
      .find(filter)
      .select('_id')
      .lean();
    const expenseIds = expensesToDelete.map((e) => e._id);

    const result = await this.expenseModel.deleteMany(filter);

    const payrollResetFilter =
      month && year
        ? { isRecordedAsExpense: true, expenseId: { $in: expenseIds } }
        : { isRecordedAsExpense: true };

    const resetResult = await this.payrollModel.updateMany(
      payrollResetFilter,
      { $set: { isRecordedAsExpense: false, expenseId: null } },
    );

    return {
      deletedCount: result.deletedCount || 0,
      resetPayrolls: resetResult.modifiedCount || 0,
      scope: month && year ? `${month}/${year}` : 'all',
    };
  }

  /**
   * Return the payroll breakdown behind a salary expense — one row per
   * employee with bonuses, commissions, deductions, KPI, net salary, and the
   * transfer screenshot used as payment receipt.
   */
  async getExpensePayrollDetails(expenseId: string): Promise<{
    expense: any;
    payrolls: any[];
    totals: {
      baseSalary: number;
      bonuses: number;
      commissions: number;
      deductions: number;
      kpiAmount: number;
      netSalary: number;
    };
  }> {
    const expense = await this.expenseModel.findById(expenseId).lean();
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.category !== 'salaries') {
      throw new BadRequestException(
        'Payroll details are only available for salary expenses',
      );
    }

    const payrolls = await this.payrollModel
      .find({ expenseId: new Types.ObjectId(expenseId) })
      .populate({
        path: 'employeeId',
        select: 'name employeeId userId',
        populate: { path: 'userId', select: 'name email' },
      })
      .lean();

    const rows = payrolls.map((p: any) => {
      const emp = p.employeeId;
      const employeeName =
        emp?.name || emp?.userId?.name || 'Unknown employee';
      return {
        _id: p._id,
        employeeName,
        employeeCode: emp?.employeeId ?? '',
        email: emp?.userId?.email ?? '',
        month: p.month,
        year: p.year,
        currency: p.currency,
        exchangeRate: p.exchangeRate,
        baseSalary: p.baseSalary,
        proratedBaseSalary: p.proratedBaseSalary,
        baseProratedBaseSalary: p.baseProratedBaseSalary,
        bonuses: p.bonuses,
        baseBonuses: p.baseBonuses,
        commissions: p.commissions,
        baseCommissions: p.baseCommissions,
        deductions: p.deductions,
        baseDeductions: p.baseDeductions,
        maxKpi: p.maxKpi,
        kpiPercentage: p.kpiPercentage,
        kpiAmount: p.kpiAmount,
        baseKpiAmount: p.baseKpiAmount,
        workedDays: p.workedDays,
        totalCycleDays: p.totalCycleDays,
        isProrated: p.isProrated,
        netSalary: p.netSalary,
        status: p.status,
        paidAt: p.paidAt,
        paymentDate: p.paymentDate,
        transferScreenshot: p.transferScreenshot,
        transactionNumber: p.transactionNumber,
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.baseSalary += r.baseProratedBaseSalary || 0;
        acc.bonuses += r.baseBonuses || 0;
        acc.commissions += r.baseCommissions || 0;
        acc.deductions += r.baseDeductions || 0;
        acc.kpiAmount += r.baseKpiAmount || 0;
        acc.netSalary += r.netSalary || 0;
        return acc;
      },
      {
        baseSalary: 0,
        bonuses: 0,
        commissions: 0,
        deductions: 0,
        kpiAmount: 0,
        netSalary: 0,
      },
    );

    return { expense, payrolls: rows, totals };
  }
}
