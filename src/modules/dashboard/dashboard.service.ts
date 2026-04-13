import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { Transaction, TransactionDocument } from '../finance/schemas/transaction.schema';
import { Attendance, AttendanceDocument } from '../attendance/schemas/attendance.schema';
import { Leave, LeaveDocument } from '../leaves/schemas/leave.schema';
import { Payroll, PayrollDocument } from '../payroll/schemas/payroll.schema';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Transaction.name) private transactionModel: Model<TransactionDocument>,
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
    @InjectModel(Leave.name) private leaveModel: Model<LeaveDocument>,
    @InjectModel(Payroll.name) private payrollModel: Model<PayrollDocument>,
  ) {}

  async getAdminDashboard() {
    const [
      totalEmployees,
      activeEmployees,
      totalClients,
      activeClients,
      totalProjects,
      activeProjects,
      completedProjects,
      totalTasks,
      completedTasks,
      pendingLeaves,
    ] = await Promise.all([
      this.employeeModel.countDocuments(),
      this.employeeModel.countDocuments({ status: 'active' }),
      this.clientModel.countDocuments(),
      this.clientModel.countDocuments({ status: 'active' }),
      this.projectModel.countDocuments(),
      this.projectModel.countDocuments({ status: 'in-progress' }),
      this.projectModel.countDocuments({ status: 'completed' }),
      this.taskModel.countDocuments(),
      this.taskModel.countDocuments({ status: 'completed' }),
      this.leaveModel.countDocuments({ status: 'pending' }),
    ]);

    // Financial summary
    const incomeAgg = await this.transactionModel.aggregate([
      { $match: { type: 'income', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const expenseAgg = await this.transactionModel.aggregate([
      { $match: { type: 'expense', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const totalRevenue = incomeAgg[0]?.total || 0;
    const totalExpenses = expenseAgg[0]?.total || 0;

    // Monthly revenue (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const monthlyRevenue = await this.transactionModel.aggregate([
      {
        $match: {
          type: 'income',
          status: 'completed',
          date: { $gte: twelveMonthsAgo },
        },
      },
      {
        $group: {
          _id: { month: { $month: '$date' }, year: { $year: '$date' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Recent projects
    const recentProjects = await this.projectModel
      .find()
      .populate('clientId', 'name company')
      .sort({ createdAt: -1 })
      .limit(5);

    // Overdue tasks
    const overdueTasks = await this.taskModel
      .find({ deadline: { $lt: new Date() }, status: { $ne: 'completed' } })
      .populate({ path: 'assignedTo', populate: { path: 'userId', select: 'name' } })
      .sort({ deadline: 1 })
      .limit(5);

    return {
      stats: {
        totalEmployees,
        activeEmployees,
        totalClients,
        activeClients,
        totalProjects,
        activeProjects,
        completedProjects,
        totalTasks,
        completedTasks,
        pendingLeaves,
      },
      finance: {
        totalRevenue,
        totalExpenses,
        profit: totalRevenue - totalExpenses,
        profitMargin: totalRevenue > 0
          ? parseFloat(((totalRevenue - totalExpenses) / totalRevenue * 100).toFixed(2))
          : 0,
      },
      monthlyRevenue,
      recentProjects,
      overdueTasks,
    };
  }

  async getEmployeeDashboard(userId: string) {
    const employee = await this.employeeModel.findOne({ userId });
    // Gracefully handle users without an employee profile (e.g., Super Admin)
    if (!employee) {
      return {
        employee: null,
        attendance: { today: null, checkedIn: false, checkedOut: false, monthSummary: { presentDays: 0, totalWorkingHours: 0 } },
        tasks: { total: 0, todo: 0, inProgress: 0, completed: 0, overdue: 0, upcoming: [] },
        leaveBalance: { total: 0, used: 0, remaining: 0 },
        latestPayroll: null,
      };
    }

    // Today's attendance — use UTC to match attendance service
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayAttendance = await this.attendanceModel.findOne({
      employeeId: employee._id,
      date: today,
    });

    // My tasks stats
    const [totalTasks, todoTasks, inProgressTasks, completedTasks, overdueTasks] = await Promise.all([
      this.taskModel.countDocuments({ assignedTo: employee._id }),
      this.taskModel.countDocuments({ assignedTo: employee._id, status: 'todo' }),
      this.taskModel.countDocuments({ assignedTo: employee._id, status: 'in-progress' }),
      this.taskModel.countDocuments({ assignedTo: employee._id, status: 'completed' }),
      this.taskModel.countDocuments({
        assignedTo: employee._id,
        deadline: { $lt: new Date() },
        status: { $ne: 'completed' },
      }),
    ]);

    // Upcoming tasks
    const upcomingTasks = await this.taskModel
      .find({ assignedTo: employee._id, status: { $ne: 'completed' } })
      .populate('projectId', 'name')
      .sort({ deadline: 1 })
      .limit(5);

    // Leave balance
    const leaveBalance = {
      total: employee.annualLeaves,
      used: employee.usedLeaves,
      remaining: employee.annualLeaves - employee.usedLeaves,
    };

    // Latest payroll
    const latestPayroll = await this.payrollModel
      .findOne({ employeeId: employee._id })
      .sort({ year: -1, month: -1 });

    // This month attendance summary
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
    const monthAttendance = await this.attendanceModel.find({
      employeeId: employee._id,
      date: { $gte: monthStart, $lte: monthEnd },
    });

    const presentDays = monthAttendance.filter(a => a.status === 'present').length;
    const totalWorkingHours = monthAttendance.reduce((s, a) => s + (a.workingHours || 0), 0);

    return {
      employee,
      attendance: {
        today: todayAttendance,
        checkedIn: !!todayAttendance?.checkIn,
        checkedOut: !!todayAttendance?.checkOut,
        monthSummary: {
          presentDays,
          totalWorkingHours: parseFloat(totalWorkingHours.toFixed(2)),
        },
      },
      tasks: {
        total: totalTasks,
        todo: todoTasks,
        inProgress: inProgressTasks,
        completed: completedTasks,
        overdue: overdueTasks,
        upcoming: upcomingTasks,
      },
      leaveBalance,
      latestPayroll: latestPayroll
        ? {
            period: `${latestPayroll.month}/${latestPayroll.year}`,
            netSalary: latestPayroll.netSalary,
            status: latestPayroll.status,
          }
        : null,
    };
  }
}
