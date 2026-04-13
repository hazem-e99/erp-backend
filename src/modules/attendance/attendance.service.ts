import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';
import { AttendanceSettings, AttendanceSettingsDocument } from './schemas/attendance-settings.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { CheckInDto, CheckOutDto } from './dto/attendance.dto';
import { UpdateAttendanceSettingsDto } from './dto/attendance-settings.dto';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
    @InjectModel(AttendanceSettings.name) private settingsModel: Model<AttendanceSettingsDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
  ) {}

  // ─── Settings helpers ────────────────────────────────────────────────────────

  /** Always returns the single settings document (creates default if missing). */
  async getSettings(): Promise<AttendanceSettingsDocument> {
    let settings = await this.settingsModel.findOne();
    if (!settings) {
      settings = await this.settingsModel.create({});
    }
    return settings;
  }

  async updateSettings(dto: UpdateAttendanceSettingsDto): Promise<AttendanceSettingsDocument> {
    let settings = await this.settingsModel.findOne();
    if (!settings) {
      settings = await this.settingsModel.create({ ...dto });
    } else {
      Object.assign(settings, dto);

      // Auto-compute standardHours from start/end times if both provided and no explicit override
      if ((dto.workStartTime || dto.workEndTime) && !dto.standardHours) {
        const start = settings.workStartTime;
        const end   = settings.workEndTime;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
        if (totalMinutes > 0) {
          settings.standardHours = parseFloat((totalMinutes / 60).toFixed(2));
        }
      }

      await settings.save();
    }
    return settings;
  }

  // ─── Date helpers ─────────────────────────────────────────────────────────────

  private getToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Parse "HH:mm" string into a Date on the given UTC day.
   */
  private parseTimeOnDay(hhMm: string, dayUtcMidnight: Date): Date {
    const [h, m] = hhMm.split(':').map(Number);
    const d = new Date(dayUtcMidnight);
    d.setUTCHours(h, m, 0, 0);
    return d;
  }

  // ─── Check-in / Check-out ────────────────────────────────────────────────────

  async checkIn(userId: string, dto: CheckInDto) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) throw new NotFoundException('Employee profile not found');

    const today = this.getToday();

    const existing = await this.attendanceModel.findOne({
      employeeId: employee._id,
      date: today,
    });

    if (existing && existing.checkIn) {
      throw new BadRequestException('Already checked in today');
    }

    const settings = await this.getSettings();
    const now = new Date();
    let lateMinutes = 0;

    // Flexible shift → never mark late
    if (settings.shiftType !== 'flexible') {
      const workStart = this.parseTimeOnDay(settings.workStartTime, today);
      if (now > workStart) {
        const rawLate = Math.floor((now.getTime() - workStart.getTime()) / 60000);
        lateMinutes = rawLate > settings.gracePeriodMinutes ? rawLate : 0;
      }
    }

    if (existing) {
      existing.checkIn = now;
      existing.lateMinutes = lateMinutes;
      existing.notes = dto.notes || existing.notes;
      await existing.save();
      return existing;
    }

    return this.attendanceModel.create({
      employeeId: employee._id,
      date: today,
      checkIn: now,
      lateMinutes,
      status: 'present',
      notes: dto.notes || '',
    });
  }

  async checkOut(userId: string, dto: CheckOutDto) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) throw new NotFoundException('Employee profile not found');

    const today = this.getToday();

    const attendance = await this.attendanceModel.findOne({
      employeeId: employee._id,
      date: today,
    });

    if (!attendance || !attendance.checkIn) {
      throw new BadRequestException('Must check in before checking out');
    }

    if (attendance.checkOut) {
      throw new BadRequestException('Already checked out today');
    }

    const settings = await this.getSettings();
    const now = new Date();
    const workingMs = now.getTime() - attendance.checkIn.getTime();
    const workingHours = parseFloat((workingMs / 3600000).toFixed(2));

    let overtimeMinutes = 0;
    if (workingHours > settings.standardHours) {
      overtimeMinutes = Math.floor((workingHours - settings.standardHours) * 60);
    }

    attendance.checkOut = now;
    attendance.workingHours = workingHours;
    attendance.overtimeMinutes = overtimeMinutes;
    if (dto.notes) attendance.notes = dto.notes;

    await attendance.save();
    return attendance;
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  async getTodayStatus(userId: string) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) throw new NotFoundException('Employee profile not found');

    const today = this.getToday();

    const attendance = await this.attendanceModel.findOne({
      employeeId: employee._id,
      date: today,
    });

    const settings = await this.getSettings();

    return {
      checkedIn: !!attendance?.checkIn,
      checkedOut: !!attendance?.checkOut,
      attendance,
      settings: {
        workStartTime: settings.workStartTime,
        workEndTime: settings.workEndTime,
        shiftType: settings.shiftType,
        gracePeriodMinutes: settings.gracePeriodMinutes,
      },
    };
  }

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, employeeId, startDate, endDate } = query;
    const filter: any = {};
    if (employeeId) filter.employeeId = employeeId;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const total = await this.attendanceModel.countDocuments(filter);
    const records = await this.attendanceModel
      .find(filter)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email avatar' } })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ date: -1 });
    return { data: records, total, page: +page, limit: +limit };
  }

  async getMyAttendance(userId: string, query: any = {}) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) throw new NotFoundException('Employee profile not found');

    const { month, year } = query;
    const filter: any = { employeeId: employee._id };

    if (month && year) {
      const start = new Date(Date.UTC(+year, +month - 1, 1));
      const end = new Date(Date.UTC(+year, +month, 0, 23, 59, 59));
      filter.date = { $gte: start, $lte: end };
    }

    return this.attendanceModel.find(filter).sort({ date: -1 });
  }

  async getMonthlyReport(employeeId: string, month: number, year: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const records = await this.attendanceModel.find({
      employeeId,
      date: { $gte: start, $lte: end },
    });

    const totalDays = records.length;
    const presentDays = records.filter(r => r.status === 'present').length;
    const totalWorkingHours = records.reduce((sum, r) => sum + (r.workingHours || 0), 0);
    const totalLateMinutes = records.reduce((sum, r) => sum + (r.lateMinutes || 0), 0);
    const totalOvertimeMinutes = records.reduce((sum, r) => sum + (r.overtimeMinutes || 0), 0);

    return {
      employeeId,
      month,
      year,
      totalDays,
      presentDays,
      absentDays: totalDays - presentDays,
      totalWorkingHours: parseFloat(totalWorkingHours.toFixed(2)),
      totalLateMinutes,
      totalOvertimeMinutes,
      avgWorkingHours: presentDays > 0 ? parseFloat((totalWorkingHours / presentDays).toFixed(2)) : 0,
    };
  }
}
