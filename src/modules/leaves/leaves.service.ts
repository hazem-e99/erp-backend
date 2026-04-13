import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Leave, LeaveDocument } from './schemas/leave.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { CreateLeaveDto, ApproveLeaveDto } from './dto/leave.dto';

@Injectable()
export class LeavesService {
  constructor(
    @InjectModel(Leave.name) private leaveModel: Model<LeaveDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
  ) {}

  async apply(userId: string, dto: CreateLeaveDto) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) throw new NotFoundException('Employee profile not found');

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (end < start) {
      throw new BadRequestException('End date must be after start date');
    }

    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;

    if (dto.type !== 'unpaid') {
      const remainingLeaves = employee.annualLeaves - employee.usedLeaves;
      if (days > remainingLeaves) {
        throw new BadRequestException(
          `Insufficient leave balance. Available: ${remainingLeaves} days`,
        );
      }
    }

    return this.leaveModel.create({
      employeeId: employee._id,
      ...dto,
      days,
    });
  }

  async approve(leaveId: string, dto: ApproveLeaveDto, userId: string) {
    const leave = await this.leaveModel.findById(leaveId);
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== 'pending') {
      throw new BadRequestException('Leave request already processed');
    }

    leave.status = dto.status;
    leave.approvedBy = userId as any;
    leave.approvedAt = new Date();

    if (dto.status === 'rejected') {
      leave.rejectionReason = dto.rejectionReason || '';
    }

    if (dto.status === 'approved' && leave.type !== 'unpaid') {
      await this.employeeModel.findByIdAndUpdate(leave.employeeId, {
        $inc: { usedLeaves: leave.days },
      });
    }

    await leave.save();
    return leave;
  }

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, status, employeeId } = query;
    const filter: any = {};
    if (status) filter.status = status;
    if (employeeId) filter.employeeId = employeeId;

    const total = await this.leaveModel.countDocuments(filter);
    const leaves = await this.leaveModel
      .find(filter)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email avatar' } })
      .populate('approvedBy', 'name email')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
    return { data: leaves, total, page: +page, limit: +limit };
  }

  async getMyLeaves(userId: string) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) throw new NotFoundException('Employee profile not found');

    const leaves = await this.leaveModel
      .find({ employeeId: employee._id })
      .sort({ createdAt: -1 });

    return {
      leaves,
      balance: {
        total: employee.annualLeaves,
        used: employee.usedLeaves,
        remaining: employee.annualLeaves - employee.usedLeaves,
      },
    };
  }

  async findById(id: string) {
    const leave = await this.leaveModel
      .findById(id)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email' } })
      .populate('approvedBy', 'name email');
    if (!leave) throw new NotFoundException('Leave not found');
    return leave;
  }
}
