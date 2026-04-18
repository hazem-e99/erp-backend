import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance, AttendanceDocument } from '../attendance/schemas/attendance.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { Leave, LeaveDocument } from '../leaves/schemas/leave.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class HrService {
  private readonly WORK_START_HOUR = 9;

  constructor(
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Leave.name) private leaveModel: Model<LeaveDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  private getToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  // ─── HR Dashboard Stats ───

  async getDashboardStats() {
    const today = this.getToday();
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const [
      totalEmployees,
      todayRecords,
      pendingLeaves,
      approvedLeavesThisMonth,
    ] = await Promise.all([
      this.employeeModel.countDocuments({ status: 'active' }),
      this.attendanceModel.find({ date: today }),
      this.leaveModel.countDocuments({ status: 'pending' }),
      this.leaveModel.countDocuments({ status: 'approved', approvedAt: { $gte: monthStart } }),
    ]);

    const presentToday = todayRecords.filter(r => r.checkIn).length;
    const lateToday = todayRecords.filter(r => r.lateMinutes > 0).length;
    const absentToday = totalEmployees - presentToday;

    return {
      totalEmployees,
      presentToday,
      absentToday,
      lateToday,
      pendingLeaves,
      approvedLeavesThisMonth,
    };
  }

  // ─── Attendance Overview ───

  async getAttendanceOverview(query: any = {}) {
    const { date, status, employeeId, page = 1, limit = 30 } = query;
    const targetDate = date ? new Date(date) : this.getToday();

    const allEmployees = await this.employeeModel.find({ status: 'active' }).populate({ path: 'userId', select: 'name email' });
    const records = await this.attendanceModel.find({ date: targetDate }).populate({ path: 'employeeId', select: 'name employeeId department departments' });

    const checkedInIds = new Set(records.map(r => r.employeeId?._id?.toString()));

    const result = allEmployees.map(emp => {
      const record = records.find(r => r.employeeId?._id?.toString() === emp._id.toString());
      return {
        employee: { _id: emp._id, name: emp.name, employeeId: emp.employeeId, department: emp.departments?.[0] || 'N/A' },
        status: record?.checkIn ? (record.lateMinutes > 0 ? 'late' : 'present') : 'absent',
        checkIn: record?.checkIn || null,
        checkOut: record?.checkOut || null,
        workingHours: record?.workingHours || 0,
        lateMinutes: record?.lateMinutes || 0,
        overtimeMinutes: record?.overtimeMinutes || 0,
      };
    });

    // Apply status filter
    let filtered = result;
    if (status === 'present') filtered = result.filter(r => r.status === 'present' || r.status === 'late');
    if (status === 'absent') filtered = result.filter(r => r.status === 'absent');
    if (status === 'late') filtered = result.filter(r => r.status === 'late');
    if (employeeId) filtered = result.filter(r => r.employee._id.toString() === employeeId);

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * limit, page * limit);

    return {
      data: paginated, total, page: +page, limit: +limit,
      date: targetDate,
      summary: {
        present: result.filter(r => r.status === 'present' || r.status === 'late').length,
        absent: result.filter(r => r.status === 'absent').length,
        late: result.filter(r => r.status === 'late').length,
        total: result.length,
      },
    };
  }

  // ─── Analytics Reports ───

  async getAnalytics(query: any = {}) {
    const { period = 'monthly', month, year, employeeId, department } = query;
    const now = new Date();
    const targetYear = +(year || now.getUTCFullYear());
    const targetMonth = +(month || now.getUTCMonth() + 1);

    let startDate: Date, endDate: Date;
    if (period === 'daily') {
      startDate = this.getToday();
      endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 1);
    } else if (period === 'yearly') {
      startDate = new Date(Date.UTC(targetYear, 0, 1));
      endDate = new Date(Date.UTC(targetYear + 1, 0, 1));
    } else {
      startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
      endDate = new Date(Date.UTC(targetYear, targetMonth, 1));
    }

    // Get employees based on filters
    const empFilter: any = { status: 'active' };
    if (department) empFilter.$or = [{ department }, { departments: department }];

    let employees = await this.employeeModel.find(empFilter).select('name employeeId department departments');
    if (employeeId) employees = employees.filter(e => e._id.toString() === employeeId);

    const empIds = employees.map(e => e._id);
    const records = await this.attendanceModel.find({
      employeeId: { $in: empIds },
      date: { $gte: startDate, $lt: endDate },
    });

    // Calculate per-employee metrics
    const employeeReports = employees.map(emp => {
      const empRecords = records.filter(r => r.employeeId.toString() === emp._id.toString());
      const present = empRecords.filter(r => r.checkIn).length;
      const totalHours = empRecords.reduce((s, r) => s + (r.workingHours || 0), 0);
      const totalLate = empRecords.filter(r => r.lateMinutes > 0).length;
      const totalOvertime = empRecords.reduce((s, r) => s + (r.overtimeMinutes || 0), 0);

      // Calculate expected working days in period
      let expectedDays = 0;
      for (let d = new Date(startDate); d < endDate; d.setDate(d.getDate() + 1)) {
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) expectedDays++; // skip weekends
      }

      return {
        employee: { _id: emp._id, name: emp.name, employeeId: emp.employeeId, department: emp.departments?.[0] || 'N/A' },
        presentDays: present,
        absentDays: Math.max(0, expectedDays - present),
        totalWorkingHours: parseFloat(totalHours.toFixed(2)),
        lateCount: totalLate,
        overtimeMinutes: totalOvertime,
        attendancePercentage: expectedDays > 0 ? parseFloat(((present / expectedDays) * 100).toFixed(1)) : 0,
        avgHoursPerDay: present > 0 ? parseFloat((totalHours / present).toFixed(2)) : 0,
      };
    });

    // Aggregated summary
    const totalPresent = employeeReports.reduce((s, r) => s + r.presentDays, 0);
    const totalAbsent = employeeReports.reduce((s, r) => s + r.absentDays, 0);
    const avgAttendance = employeeReports.length > 0
      ? parseFloat((employeeReports.reduce((s, r) => s + r.attendancePercentage, 0) / employeeReports.length).toFixed(1))
      : 0;

    return {
      period, startDate, endDate,
      summary: { totalEmployees: employees.length, totalPresent, totalAbsent, avgAttendance },
      employees: employeeReports,
    };
  }

  // ─── Attendance Trend (for charts) ───

  async getAttendanceTrend(query: any = {}) {
    const { days = 30 } = query;
    const endDate = this.getToday();
    endDate.setDate(endDate.getDate() + 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    const totalEmps = await this.employeeModel.countDocuments({ status: 'active' });
    const records = await this.attendanceModel.find({ date: { $gte: startDate, $lt: endDate } });

    const trend: any[] = [];
    for (let d = new Date(startDate); d < endDate; d.setDate(d.getDate() + 1)) {
      const day = d.getUTCDay();
      if (day === 0 || day === 6) continue; // skip weekends
      const dayStr = d.toISOString().split('T')[0];
      const dayRecords = records.filter(r => r.date.toISOString().split('T')[0] === dayStr);
      const present = dayRecords.filter(r => r.checkIn).length;
      const late = dayRecords.filter(r => r.lateMinutes > 0).length;

      trend.push({
        date: dayStr,
        present,
        absent: totalEmps - present,
        late,
        total: totalEmps,
      });
    }

    return { trend, totalEmployees: totalEmps };
  }

  // ─── Leave Stats (for HR dashboard chart) ───

  async getLeaveStats(query: any = {}) {
    const { month, year } = query;
    const now = new Date();
    const targetYear = +(year || now.getUTCFullYear());
    const targetMonth = +(month || now.getUTCMonth() + 1);
    const start = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
    const end = new Date(Date.UTC(targetYear, targetMonth, 1));

    const [pending, approved, rejected] = await Promise.all([
      this.leaveModel.countDocuments({ status: 'pending', startDate: { $gte: start, $lt: end } }),
      this.leaveModel.countDocuments({ status: 'approved', startDate: { $gte: start, $lt: end } }),
      this.leaveModel.countDocuments({ status: 'rejected', startDate: { $gte: start, $lt: end } }),
    ]);

    return { pending, approved, rejected, total: pending + approved + rejected };
  }
}
