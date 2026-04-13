import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as ExcelJS from 'exceljs';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { Attendance, AttendanceDocument } from '../attendance/schemas/attendance.schema';
import { Leave, LeaveDocument } from '../leaves/schemas/leave.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';

@Injectable()
export class ExportService {
  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
    @InjectModel(Leave.name) private leaveModel: Model<LeaveDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
  ) {}

  private styleSheet(ws: ExcelJS.Worksheet) {
    // Style header row
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    ws.getRow(1).height = 28;
  }

  async exportEmployees(query: any = {}): Promise<Buffer> {
    const { department, status } = query;
    const filter: any = {};
    if (department) filter.$or = [{ department }, { departments: department }];
    if (status) filter.status = status;

    const employees = await this.employeeModel.find(filter).populate({ path: 'userId', select: 'name email' });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employees');
    ws.columns = [
      { header: 'Employee ID', key: 'employeeId', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Position', key: 'position', width: 18 },
      { header: 'Salary', key: 'salary', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Join Date', key: 'joinDate', width: 14 },
      { header: 'WhatsApp', key: 'whatsapp', width: 18 },
    ];
    this.styleSheet(ws);

    for (const e of employees) {
      ws.addRow({
        employeeId: e.employeeId,
        name: e.name,
        email: e.emailAddress,
        department: e.department || e.departments?.join(', '),
        position: e.position || e.positions?.join(', '),
        salary: e.baseSalary,
        status: e.status,
        joinDate: e.dateOfJoining ? new Date(e.dateOfJoining).toLocaleDateString() : '',
        whatsapp: e.whatsappNumber || '',
      });
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportAttendance(query: any = {}): Promise<Buffer> {
    const { startDate, endDate, employeeId } = query;
    const filter: any = {};
    if (employeeId) filter.employeeId = employeeId;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const records = await this.attendanceModel.find(filter)
      .populate({ path: 'employeeId', select: 'name employeeId department' })
      .sort({ date: -1 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Attendance');
    ws.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Employee ID', key: 'employeeId', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Check In', key: 'checkIn', width: 12 },
      { header: 'Check Out', key: 'checkOut', width: 12 },
      { header: 'Working Hours', key: 'hours', width: 14 },
      { header: 'Late (min)', key: 'late', width: 12 },
      { header: 'Overtime (min)', key: 'overtime', width: 14 },
      { header: 'Status', key: 'status', width: 10 },
    ];
    this.styleSheet(ws);

    for (const r of records) {
      const emp = r.employeeId as any;
      ws.addRow({
        date: r.date ? new Date(r.date).toLocaleDateString() : '',
        employeeId: emp?.employeeId || '',
        name: emp?.name || '',
        checkIn: r.checkIn ? new Date(r.checkIn).toLocaleTimeString() : '',
        checkOut: r.checkOut ? new Date(r.checkOut).toLocaleTimeString() : '',
        hours: r.workingHours || 0,
        late: r.lateMinutes || 0,
        overtime: r.overtimeMinutes || 0,
        status: r.status,
      });
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportLeaves(query: any = {}): Promise<Buffer> {
    const { status, startDate, endDate } = query;
    const filter: any = {};
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.startDate = {};
      if (startDate) filter.startDate.$gte = new Date(startDate);
      if (endDate) filter.startDate.$lte = new Date(endDate);
    }

    const leaves = await this.leaveModel.find(filter)
      .populate({ path: 'employeeId', select: 'name employeeId' })
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leaves');
    ws.columns = [
      { header: 'Employee', key: 'name', width: 25 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'From', key: 'from', width: 14 },
      { header: 'To', key: 'to', width: 14 },
      { header: 'Days', key: 'days', width: 8 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Reason', key: 'reason', width: 30 },
      { header: 'Approved By', key: 'approvedBy', width: 20 },
    ];
    this.styleSheet(ws);

    for (const l of leaves) {
      const emp = l.employeeId as any;
      ws.addRow({
        name: emp?.name || '',
        type: l.type,
        from: new Date(l.startDate).toLocaleDateString(),
        to: new Date(l.endDate).toLocaleDateString(),
        days: l.days,
        status: l.status,
        reason: l.reason,
        approvedBy: (l.approvedBy as any)?.name || '',
      });
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportProjects(query: any = {}): Promise<Buffer> {
    const { status } = query;
    const filter: any = {};
    if (status) filter.status = status;

    const projects = await this.projectModel.find(filter)
      .populate('clientId', 'name')
      .sort({ createdAt: -1 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Projects');
    ws.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Client', key: 'client', width: 20 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Start Date', key: 'start', width: 14 },
      { header: 'Deadline', key: 'deadline', width: 14 },
      { header: 'Budget', key: 'budget', width: 12 },
      { header: 'Spent', key: 'spent', width: 12 },
      { header: 'Team Size', key: 'team', width: 10 },
    ];
    this.styleSheet(ws);

    for (const p of projects) {
      ws.addRow({
        name: p.name,
        client: (p.clientId as any)?.name || '',
        status: p.status,
        priority: p.priority,
        start: new Date(p.startDate).toLocaleDateString(),
        deadline: new Date(p.deadline).toLocaleDateString(),
        budget: p.budget,
        spent: p.spent,
        team: p.teamMembers?.length || 0,
      });
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportTasks(query: any = {}): Promise<Buffer> {
    const { status, startDate, endDate } = query;
    const filter: any = {};
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.deadline = {};
      if (startDate) filter.deadline.$gte = new Date(startDate);
      if (endDate) filter.deadline.$lte = new Date(endDate);
    }

    const tasks = await this.taskModel.find(filter)
      .populate('assignedTo', 'name')
      .populate('projectId', 'name')
      .sort({ createdAt: -1 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tasks');
    ws.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Project', key: 'project', width: 20 },
      { header: 'Assigned To', key: 'assigned', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Deadline', key: 'deadline', width: 14 },
    ];
    this.styleSheet(ws);

    for (const t of tasks) {
      ws.addRow({
        title: t.title,
        project: (t.projectId as any)?.name || '',
        assigned: (t.assignedTo as any)?.name || '',
        status: t.status,
        priority: t.priority,
        deadline: t.deadline ? new Date(t.deadline).toLocaleDateString() : '',
      });
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
