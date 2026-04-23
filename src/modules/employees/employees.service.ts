import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Employee, EmployeeDocument } from './schemas/employee.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { CreateEmployeeDto, UpdateEmployeeDto, UpdateProfileDto, ChangePasswordDto, AdminResetPasswordDto } from './dto/employee.dto';
import { calculateBaseAmount } from '../finance/validators/finance.validators';
import { BASE_CURRENCY } from '../finance/constants/currency.constants';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
  ) {}

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, search, department, status } = query;
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
    const emp = await this.employeeModel.findById(id).populate({ path: 'userId', select: '-password' });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  async findByUserId(userId: string) {
    return this.employeeModel.findOne({ userId }).populate({ path: 'userId', select: '-password' });
  }

  /**
   * Create employee + auto-create linked User account
   */
  async create(dto: CreateEmployeeDto) {
    // Check for duplicate email
    const emailExists = await this.userModel.findOne({ email: dto.emailAddress });
    if (emailExists) throw new ConflictException('Email already in use');

    const empIdExists = await this.employeeModel.findOne({ employeeId: dto.employeeId });
    if (empIdExists) throw new ConflictException('Employee ID already exists');

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Get Employee role
    let employeeRole = await this.roleModel.findOne({ name: 'Employee' });
    if (!employeeRole) {
      employeeRole = await this.roleModel.findOne({ isSystem: true, name: { $ne: 'Super Admin' } });
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

    return this.employeeModel.findById(employee._id).populate({ path: 'userId', select: '-password' });
  }

  /**
   * Admin update – can change salary, role, departments, etc.
   */
  async update(id: string, dto: UpdateEmployeeDto) {
    const emp = await this.employeeModel.findById(id);
    if (!emp) throw new NotFoundException('Employee not found');

    // Calculate base amounts if currency fields change
    const updateData: any = { ...dto };
    
    const newCurrency = dto.currency !== undefined ? dto.currency : emp.currency;
    const newExchangeRate = dto.exchangeRate !== undefined ? dto.exchangeRate : emp.exchangeRate;
    const newBaseSalary = dto.baseSalary !== undefined ? dto.baseSalary : emp.baseSalary;
    const newMaxKpi = dto.maxKpi !== undefined ? dto.maxKpi : emp.maxKpi;

    // Recalculate base amounts if any relevant field changed
    if (dto.baseSalary !== undefined || dto.exchangeRate !== undefined || dto.currency !== undefined) {
      updateData.baseBaseSalary = calculateBaseAmount(newBaseSalary, newExchangeRate);
    }
    if (dto.maxKpi !== undefined || dto.exchangeRate !== undefined || dto.currency !== undefined) {
      updateData.baseMaxKpi = calculateBaseAmount(newMaxKpi, newExchangeRate);
    }

    const updatedEmp = await this.employeeModel.findByIdAndUpdate(id, updateData, { new: true })
      .populate({ path: 'userId', select: '-password' });

    // Sync name to User if changed
    if (dto.name) {
      await this.userModel.findByIdAndUpdate(updatedEmp!.userId, { name: dto.name });
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
    if (dto.whatsappNumber !== undefined) emp.whatsappNumber = dto.whatsappNumber;
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
    if (!isMatch) throw new BadRequestException('Current password is incorrect');

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
    await this.userModel.findByIdAndUpdate(emp.userId, { password: hashedPassword });
    return { message: 'Password reset successfully' };
  }

  /**
   * Soft delete – set status to terminated + deactivate user
   */
  async delete(id: string) {
    const emp = await this.employeeModel.findById(id);
    if (!emp) throw new NotFoundException('Employee not found');

    emp.status = 'terminated';
    await emp.save();

    // Deactivate user account
    await this.userModel.findByIdAndUpdate(emp.userId, { isActive: false });

    return { message: 'Employee terminated and account deactivated' };
  }

  /**
   * Hard delete employee and linked user account
   */
  async deletePermanently(id: string, currentUserId?: string) {
    const emp = await this.employeeModel.findById(id);
    if (!emp) throw new NotFoundException('Employee not found');

    const linkedUserId = emp.userId?.toString();
    if (currentUserId && linkedUserId === currentUserId) {
      throw new ForbiddenException('You cannot permanently delete your own account');
    }

    await this.employeeModel.findByIdAndDelete(id);

    if (linkedUserId) {
      await this.userModel.findByIdAndDelete(linkedUserId);
    }

    return { message: 'Employee and linked user account deleted permanently' };
  }
}
