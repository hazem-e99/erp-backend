import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Employee, EmployeeDocument } from './schemas/employee.schema';
import {
  EmployeeSettlement,
  EmployeeSettlementDocument,
} from './schemas/employee-settlement.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { Payroll, PayrollDocument } from '../payroll/schemas/payroll.schema';
import {
  PayrollConfig,
  PayrollConfigDocument,
} from '../payroll/schemas/payroll-config.schema';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  UpdateProfileDto,
  ChangePasswordDto,
  AdminResetPasswordDto,
} from './dto/employee.dto';
import { CreateEmployeeSettlementDto } from './dto/settlement.dto';
import { calculateBaseAmount } from '../finance/validators/finance.validators';
import { BASE_CURRENCY } from '../finance/constants/currency.constants';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    @InjectModel(EmployeeSettlement.name)
    private settlementModel: Model<EmployeeSettlementDocument>,
    @InjectModel(Payroll.name) private payrollModel: Model<PayrollDocument>,
    @InjectModel(PayrollConfig.name)
    private payrollConfigModel: Model<PayrollConfigDocument>,
  ) {}

  private async terminateEmployeeCore(emp: EmployeeDocument) {
    emp.status = 'terminated';
    await emp.save();

    // Deactivate user account
    await this.userModel.findByIdAndUpdate(emp.userId, { isActive: false });

    // NOTE: Payroll history is intentionally preserved on termination.
    // The final (possibly prorated) payroll for the termination month
    // should be generated separately before terminating the employee.
  }

  /**
   * Bulk-set dateOfJoining = cycle start of the selected payroll month for
   * every active employee who joined BEFORE that date.
   *
   * The target is `cycleStartDay` of the PREVIOUS calendar month (default:
   * day 26). This guarantees the employee covers a full 30-day payroll cycle
   * up to `cycleEndDay` (default: day 25) — independent of whether the
   * underlying calendar month has 28, 29, 30, or 31 days.
   *
   * Employees who joined on/after the cycle start are NOT modified, so
   * legitimate mid-cycle joiners still get prorated correctly.
   */
  async normalizeJoiningDates(month: number, year: number) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Invalid month');
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Invalid year');
    }

    // Read the singleton payroll cycle config to find cycleStartDay.
    // Auto-create with defaults (26/25/25) if missing — matches PayrollService.getConfig.
    let config = await this.payrollConfigModel.findOne();
    if (!config) {
      config = await this.payrollConfigModel.create({
        cycleStartDay: 26,
        cycleEndDay: 25,
        paymentDay: 25,
      });
    }

    // cycleStart = cycleStartDay of the PREVIOUS calendar month
    let startMonth = month - 1;
    let startYear = year;
    if (startMonth === 0) {
      startMonth = 12;
      startYear = year - 1;
    }
    const target = new Date(
      Date.UTC(startYear, startMonth - 1, config.cycleStartDay),
    );

    const result = await this.employeeModel.updateMany(
      {
        status: 'active',
        dateOfJoining: { $lt: target },
      },
      { $set: { dateOfJoining: target } },
    );

    return {
      updated: result.modifiedCount || 0,
      matched: result.matchedCount || 0,
      target: target.toISOString().split('T')[0],
      cycleStartDay: config.cycleStartDay,
    };
  }

  /**
   * Flip the per-employee Payroll visibility flag. The employee stays active;
   * only their visibility on the Payroll page changes.
   */
  async setPayrollExclusion(id: string, excludeFromPayroll: boolean) {
    const emp = await this.employeeModel.findByIdAndUpdate(
      id,
      { $set: { excludeFromPayroll } },
      { new: true },
    );
    if (!emp) throw new NotFoundException('Employee not found');
    return {
      _id: emp._id,
      name: emp.name,
      excludeFromPayroll: emp.excludeFromPayroll,
    };
  }

  async findAll(query: any = {}) {
    const {
      page = 1,
      limit = 20,
      search,
      department,
      status,
      excludeFromPayroll,
    } = query;
    const filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { position: { $regex: search, $options: 'i' } },
        { emailAddress: { $regex: search, $options: 'i' } },
      ];
    }
    if (department) filter.department = department;
    if (status) filter.status = status;
    // Optional filter by Payroll-visibility flag. Accepts 'true' / 'false'
    // strings (query params) or actual booleans.
    if (excludeFromPayroll === true || excludeFromPayroll === 'true') {
      filter.excludeFromPayroll = true;
    } else if (excludeFromPayroll === false || excludeFromPayroll === 'false') {
      filter.excludeFromPayroll = { $ne: true };
    }

    const total = await this.employeeModel.countDocuments(filter);
    const employees = await this.employeeModel
      .find(filter)
      .populate({ path: 'userId', select: '-password' })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
    return { data: employees, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const emp = await this.employeeModel
      .findById(id)
      .populate({ path: 'userId', select: '-password' });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  async findByUserId(userId: string) {
    return this.employeeModel
      .findOne({ userId })
      .populate({ path: 'userId', select: '-password' });
  }

  /**
   * Create employee + auto-create linked User account
   */
  async create(dto: CreateEmployeeDto) {
    // Check for duplicate email
    const emailExists = await this.userModel.findOne({
      email: dto.emailAddress,
    });
    if (emailExists) throw new ConflictException('Email already in use');

    const empIdExists = await this.employeeModel.findOne({
      employeeId: dto.employeeId,
    });
    if (empIdExists) throw new ConflictException('Employee ID already exists');

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Get Employee role
    let employeeRole = await this.roleModel.findOne({ name: 'Employee' });
    if (!employeeRole) {
      employeeRole = await this.roleModel.findOne({
        isSystem: true,
        name: { $ne: 'Super Admin' },
      });
    }

    // Create User account
    const user = await this.userModel.create({
      name: dto.name,
      email: dto.emailAddress,
      password: hashedPassword,
      phone: dto.whatsappNumber || null,
      role: employeeRole?._id || null,
      isActive: true,
    } as any);

    // Create Employee profile linked to user
    const currency = dto.currency || BASE_CURRENCY;
    const exchangeRate = dto.exchangeRate || 1;
    const baseBaseSalary = calculateBaseAmount(dto.baseSalary, exchangeRate);
    const baseMaxKpi = calculateBaseAmount(dto.maxKpi || 0, exchangeRate);

    const employee = await this.employeeModel.create({
      userId: user._id,
      employeeId: dto.employeeId,
      name: dto.name,
      emailAddress: dto.emailAddress,
      age: dto.age || null,
      currency,
      exchangeRate,
      baseSalary: dto.baseSalary,
      maxKpi: dto.maxKpi || 0,
      baseBaseSalary,
      baseMaxKpi,
      dateOfJoining: dto.dateOfJoining,
      dateOfBirth: dto.dateOfBirth || null,
      address: dto.address || null,
      emergencyContact: dto.emergencyContact || null,
      whatsappNumber: dto.whatsappNumber || null,
      positions: dto.positions || [],
      departments: dto.departments || [],
      contractTypes: dto.contractTypes || [],
    } as any);

    return this.employeeModel
      .findById(employee._id)
      .populate({ path: 'userId', select: '-password' });
  }

  /**
   * Admin update – can change salary, role, departments, etc.
   */
  async update(id: string, dto: UpdateEmployeeDto) {
    const emp = await this.employeeModel.findById(id);
    if (!emp) throw new NotFoundException('Employee not found');

    // Calculate base amounts if currency fields change
    const updateData: any = { ...dto };

    const newCurrency =
      dto.currency !== undefined ? dto.currency : emp.currency;
    const newExchangeRate =
      dto.exchangeRate !== undefined ? dto.exchangeRate : emp.exchangeRate;
    const newBaseSalary =
      dto.baseSalary !== undefined ? dto.baseSalary : emp.baseSalary;
    const newMaxKpi = dto.maxKpi !== undefined ? dto.maxKpi : emp.maxKpi;

    // Recalculate base amounts if any relevant field changed
    if (
      dto.baseSalary !== undefined ||
      dto.exchangeRate !== undefined ||
      dto.currency !== undefined
    ) {
      updateData.baseBaseSalary = calculateBaseAmount(
        newBaseSalary,
        newExchangeRate,
      );
    }
    if (
      dto.maxKpi !== undefined ||
      dto.exchangeRate !== undefined ||
      dto.currency !== undefined
    ) {
      updateData.baseMaxKpi = calculateBaseAmount(newMaxKpi, newExchangeRate);
    }

    const updatedEmp = await this.employeeModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate({ path: 'userId', select: '-password' });

    // Sync name to User if changed
    if (dto.name) {
      await this.userModel.findByIdAndUpdate(updatedEmp!.userId, {
        name: dto.name,
      });
    }

    return updatedEmp;
  }

  /**
   * Self-profile update – limited fields only
   */
  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    const emp = await this.employeeModel.findOne({ userId });
    if (!emp) throw new NotFoundException('Employee profile not found');

    // Update employee fields
    if (dto.name) emp.name = dto.name;
    if (dto.address !== undefined) emp.address = dto.address;
    if (dto.whatsappNumber !== undefined)
      emp.whatsappNumber = dto.whatsappNumber;
    await emp.save();

    // Sync to User
    const userUpdate: any = {};
    if (dto.name) userUpdate.name = dto.name;
    if (dto.phone !== undefined) userUpdate.phone = dto.phone;
    if (Object.keys(userUpdate).length > 0) {
      await this.userModel.findByIdAndUpdate(userId, userUpdate);
    }

    return emp.populate({ path: 'userId', select: '-password' });
  }

  /**
   * Change own password
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await bcrypt.compare(dto.oldPassword, user.password);
    if (!isMatch)
      throw new BadRequestException('Current password is incorrect');

    user.password = await bcrypt.hash(dto.newPassword, 12);
    await user.save();
    return { message: 'Password changed successfully' };
  }

  /**
   * Admin reset password for any user
   */
  async adminResetPassword(employeeId: string, dto: AdminResetPasswordDto) {
    const emp = await this.employeeModel.findById(employeeId);
    if (!emp) throw new NotFoundException('Employee not found');

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.userModel.findByIdAndUpdate(emp.userId, {
      password: hashedPassword,
    });
    return { message: 'Password reset successfully' };
  }

  /**
   * Soft delete – set status to terminated + deactivate user
   */
  async delete(id: string) {
    const emp = await this.employeeModel.findById(id);
    if (!emp) throw new NotFoundException('Employee not found');

    // Set terminationDate to today so future payroll generation can prorate correctly
    await this.employeeModel.findByIdAndUpdate(emp._id, {
      terminationDate: new Date(),
    });
    await this.terminateEmployeeCore(emp);

    return { message: 'Employee terminated and account deactivated' };
  }

  /**
   * Terminate employee + record final settlement
   */
  async terminateWithSettlement(id: string, dto: CreateEmployeeSettlementDto) {
    const emp = await this.employeeModel.findById(id);
    if (!emp) throw new NotFoundException('Employee not found');

    await this.terminateEmployeeCore(emp);

    // Store the last working day on the employee record for payroll proration
    if (dto.lastWorkingDay) {
      await this.employeeModel.findByIdAndUpdate(emp._id, {
        terminationDate: dto.lastWorkingDay,
      });
    }

    const accruedSalary = dto.accruedSalary ?? 0;
    const bonuses = dto.bonuses ?? 0;
    const deductions = dto.deductions ?? 0;
    const otherAdjustments = dto.otherAdjustments ?? 0;
    const netSettlement =
      accruedSalary + bonuses - deductions + otherAdjustments;

    const currency = emp.currency || BASE_CURRENCY;
    const exchangeRate = emp.exchangeRate || 1;

    const settlement = await this.settlementModel.create({
      employeeId: emp._id,
      employeeName: emp.name,
      employeeNumber: emp.employeeId,
      currency,
      exchangeRate,
      terminationDate: dto.terminationDate,
      lastWorkingDay: dto.lastWorkingDay,
      accruedSalary,
      bonuses,
      deductions,
      otherAdjustments,
      netSettlement,
      baseAccruedSalary: calculateBaseAmount(accruedSalary, exchangeRate),
      baseBonuses: calculateBaseAmount(bonuses, exchangeRate),
      baseDeductions: calculateBaseAmount(deductions, exchangeRate),
      baseOtherAdjustments: calculateBaseAmount(otherAdjustments, exchangeRate),
      baseNetSettlement: calculateBaseAmount(netSettlement, exchangeRate),
      notes: dto.notes || '',
    });

    return {
      message: 'Employee terminated and settlement recorded',
      settlement,
    };
  }

  /**
   * Hard delete employee and linked user account
   */
  async deletePermanently(id: string, currentUserId?: string) {
    const emp = await this.employeeModel.findById(id);
    if (!emp) throw new NotFoundException('Employee not found');

    const linkedUserId = emp.userId?.toString();
    if (currentUserId && linkedUserId === currentUserId) {
      throw new ForbiddenException(
        'You cannot permanently delete your own account',
      );
    }

    // Block hard-delete if the employee has any payroll history. The admin
    // must delete each payroll first (UI offers a per-payroll Delete) so
    // linked Finance expenses stay consistent.
    const payrollCount = await this.payrollModel.countDocuments({
      employeeId: emp._id,
    });
    if (payrollCount > 0) {
      throw new BadRequestException(
        `Cannot permanently delete: employee has ${payrollCount} payroll record(s). Delete or unlink them first.`,
      );
    }

    await this.employeeModel.findByIdAndDelete(id);

    if (linkedUserId) {
      await this.userModel.findByIdAndDelete(linkedUserId);
    }

    return { message: 'Employee and linked user account deleted permanently' };
  }
}
