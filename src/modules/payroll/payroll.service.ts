import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payroll, PayrollDocument } from './schemas/payroll.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { Attendance, AttendanceDocument } from '../attendance/schemas/attendance.schema';
import { Leave, LeaveDocument } from '../leaves/schemas/leave.schema';
import { Expense, ExpenseDocument } from '../finance/schemas/expense.schema';
import { GeneratePayrollDto, UpdatePayrollDto } from './dto/payroll.dto';
import { calculateBaseAmount } from '../finance/validators/finance.validators';
import { BASE_CURRENCY } from '../finance/constants/currency.constants';

@Injectable()
export class PayrollService {
  // Overtime rate: 1.5x hourly rate
  private readonly OVERTIME_MULTIPLIER = 1.5;

  constructor(
    @InjectModel(Payroll.name) private payrollModel: Model<PayrollDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
    @InjectModel(Leave.name) private leaveModel: Model<LeaveDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
  ) {}

  async generate(dto: GeneratePayrollDto) {
    const employee = await this.employeeModel.findById(dto.employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    const existing = await this.payrollModel.findOne({
      employeeId: dto.employeeId,
      month: dto.month,
      year: dto.year,
    });
    if (existing) throw new ConflictException('Payroll already generated for this month');

    // Get attendance data
    const start = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const end = new Date(Date.UTC(dto.year, dto.month, 0, 23, 59, 59));

    const attendanceRecords = await this.attendanceModel.find({
      employeeId: dto.employeeId,
      date: { $gte: start, $lte: end },
    });

    const presentDays = attendanceRecords.filter(r => r.status === 'present').length;
    const totalWorkingHours = attendanceRecords.reduce((s, r) => s + (r.workingHours || 0), 0);
    const totalOvertimeMinutes = attendanceRecords.reduce((s, r) => s + (r.overtimeMinutes || 0), 0);
    const totalLateMinutes = attendanceRecords.reduce((s, r) => s + (r.lateMinutes || 0), 0);

    // Calculate working days in the month (excl. weekends)
    const totalDaysInMonth = new Date(dto.year, dto.month, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const day = new Date(dto.year, dto.month - 1, d).getDay();
      if (day !== 0 && day !== 6) workingDays++;
    }

    // Prevent division by zero
    if (workingDays === 0) {
      throw new ConflictException('No working days in this month — cannot calculate payroll');
    }

    // Get currency from employee
    const currency = employee.currency || 'EGP';
    const exchangeRate = employee.exchangeRate || 1;

    // All calculations in original currency first
    const baseSalary = employee.baseSalary;
    const dailyRate = baseSalary / workingDays;
    const hourlyRate = dailyRate / 8;

    // Calculate overtime pay (in original currency)
    const overtimeHours = totalOvertimeMinutes / 60;
    const overtimePay = parseFloat((overtimeHours * hourlyRate * this.OVERTIME_MULTIPLIER).toFixed(2));

    // Approved leaves in this period — don't count as absent
    const approvedLeaves = await this.leaveModel.find({
      employeeId: dto.employeeId,
      status: 'approved',
      startDate: { $lte: end },
      endDate: { $gte: start },
    });
    const approvedLeaveDays = approvedLeaves.reduce((sum, l) => sum + (l.days || 0), 0);

    // Track absent days for reporting only (not for automatic deduction)
    const absentDays = Math.max(0, workingDays - presentDays - approvedLeaveDays);
    const absentDeduction = 0; // Deductions are manual only

    const bonuses = dto.bonuses || 0;
    const deductions = dto.deductions || 0; // Manual deductions only

    // Calculate KPI amount (in original currency)
    const maxKpi = dto.maxKpi || employee.maxKpi || 0;
    const kpiPercentage = dto.kpiPercentage || 0;
    const kpiAmount = parseFloat(((maxKpi * kpiPercentage) / 100).toFixed(2));

    // Calculate base currency amounts for all financial values
    const baseBaseSalary = calculateBaseAmount(baseSalary, exchangeRate);
    const baseBonuses = calculateBaseAmount(bonuses, exchangeRate);
    const baseDeductions = calculateBaseAmount(deductions, exchangeRate);
    const baseOvertimePay = calculateBaseAmount(overtimePay, exchangeRate);
    const baseMaxKpi = calculateBaseAmount(maxKpi, exchangeRate);
    const baseKpiAmount = calculateBaseAmount(kpiAmount, exchangeRate);

    // Net salary is sum of all base amounts (always in base currency)
    const netSalary = parseFloat((baseBaseSalary + baseBonuses + baseOvertimePay - baseDeductions + baseKpiAmount).toFixed(2));

    const breakdown = {
      baseSalary,
      dailyRate: parseFloat(dailyRate.toFixed(2)),
      hourlyRate: parseFloat(hourlyRate.toFixed(2)),
      workingDays,
      presentDays,
      absentDays,
      approvedLeaveDays,
      totalWorkingHours: parseFloat(totalWorkingHours.toFixed(2)),
      overtimeHours: parseFloat(overtimeHours.toFixed(2)),
      overtimePay,
      totalLateMinutes,
      bonuses,
      manualDeductions: dto.deductions || 0,
      absentDeduction,
      totalDeductions: deductions,
      maxKpi,
      kpiPercentage,
      kpiAmount,
      netSalary,
    };

    return this.payrollModel.create({
      employeeId: dto.employeeId,
      month: dto.month,
      year: dto.year,
      currency,
      exchangeRate,
      baseSalary,
      bonuses,
      deductions,
      overtimePay,
      maxKpi,
      kpiPercentage,
      kpiAmount,
      baseBaseSalary,
      baseBonuses,
      baseDeductions,
      baseOvertimePay,
      baseMaxKpi,
      baseKpiAmount,
      netSalary,
      workingDays,
      presentDays,
      status: 'draft',
      notes: dto.notes || '',
      breakdown,
    });
  }

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, month, year, status, employeeId } = query;
    const filter: any = {};
    if (month) filter.month = +month;
    if (year) filter.year = +year;
    if (status) filter.status = status;
    if (employeeId) filter.employeeId = employeeId;

    const total = await this.payrollModel.countDocuments(filter);
    const payrolls = await this.payrollModel
      .find(filter)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email avatar' } })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ year: -1, month: -1 });
    return { data: payrolls, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const payroll = await this.payrollModel
      .findById(id)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email avatar' } });
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
    if (dto.deductions !== undefined) {
      payroll.deductions = dto.deductions;
      payroll.baseDeductions = calculateBaseAmount(dto.deductions, exchangeRate);
    }
    if (dto.maxKpi !== undefined) {
      payroll.maxKpi = dto.maxKpi;
      payroll.baseMaxKpi = calculateBaseAmount(dto.maxKpi, exchangeRate);
    }
    if (dto.kpiPercentage !== undefined) {
      payroll.kpiPercentage = dto.kpiPercentage;
    }
    if (dto.transferScreenshot !== undefined) payroll.transferScreenshot = dto.transferScreenshot;
    if (dto.transactionNumber !== undefined) payroll.transactionNumber = dto.transactionNumber;
    if (dto.status) {
      payroll.status = dto.status;
      if (dto.status === 'paid') payroll.paidAt = new Date();
    }
    if (dto.notes) payroll.notes = dto.notes;

    // Recalculate KPI amount (in original currency)
    payroll.kpiAmount = parseFloat(((payroll.maxKpi * payroll.kpiPercentage) / 100).toFixed(2));
    payroll.baseKpiAmount = calculateBaseAmount(payroll.kpiAmount, exchangeRate);

    // Recalculate net salary (sum of all base amounts)
    payroll.netSalary = parseFloat(
      (payroll.baseBaseSalary + payroll.baseBonuses + payroll.baseOvertimePay - payroll.baseDeductions + payroll.baseKpiAmount).toFixed(2),
    );

    await payroll.save();
    return payroll;
  }

  async getPayslip(id: string) {
    const payroll = await this.payrollModel
      .findById(id)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email' } });
    if (!payroll) throw new NotFoundException('Payroll not found');

    return {
      payslipId: payroll._id,
      employee: payroll.employeeId,
      period: `${payroll.month}/${payroll.year}`,
      baseSalary: payroll.baseSalary,
      bonuses: payroll.bonuses,
      overtimePay: payroll.overtimePay,
      deductions: payroll.deductions,
      netSalary: payroll.netSalary,
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
  async markAsExpenses(): Promise<{ total: number; count: number; expense: any }> {
    // Find all paid payrolls not yet recorded
    const pendingPayrolls = await this.payrollModel.find({
      status: 'paid',
      isRecordedAsExpense: false,
    });

    if (pendingPayrolls.length === 0) {
      throw new NotFoundException('No paid payrolls to record as expenses');
    }

    // Calculate total (netSalary is already in base currency)
    const totalBaseAmount = pendingPayrolls.reduce((sum, p) => sum + p.netSalary, 0);

    // Create expense record in base currency
    const expense = await this.expenseModel.create({
      amount: totalBaseAmount,
      currency: BASE_CURRENCY,
      exchangeRate: 1,
      baseAmount: totalBaseAmount,
      category: 'salaries',
      date: new Date(),
      description: `Salary payments for ${pendingPayrolls.length} employee(s)`,
      attachmentUrl: '',
    });

    // Mark all as recorded
    await this.payrollModel.updateMany(
      {
        status: 'paid',
        isRecordedAsExpense: false,
      },
      {
        $set: { isRecordedAsExpense: true },
      },
    );

    return {
      total: totalBaseAmount,
      count: pendingPayrolls.length,
      expense,
    };
  }
}
