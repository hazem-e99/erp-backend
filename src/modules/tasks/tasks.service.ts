import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from './schemas/task.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
  ) {}

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, search, status, priority, assignedTo, projectId } = query;
    const filter: any = {};
    if (search) {
      filter.title = { $regex: search, $options: 'i' };
    }
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (projectId) filter.projectId = projectId;

    const total = await this.taskModel.countDocuments(filter);
    const tasks = await this.taskModel
      .find(filter)
      .populate({ path: 'assignedTo', populate: { path: 'userId', select: 'name email avatar' } })
      .populate('projectId', 'name')
      .populate('createdBy', 'name email')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
    return { data: tasks, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const task = await this.taskModel
      .findById(id)
      .populate({ path: 'assignedTo', populate: { path: 'userId', select: 'name email avatar' } })
      .populate('projectId', 'name')
      .populate('createdBy', 'name email');
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async findByEmployee(employeeId: string, query: any = {}) {
    const { status } = query;
    const filter: any = { assignedTo: employeeId };
    if (status) filter.status = status;
    return this.taskModel
      .find(filter)
      .populate('projectId', 'name')
      .sort({ deadline: 1, priority: -1 });
  }

  /**
   * Returns tasks assigned to the currently logged-in user.
   * Resolves userId → employeeId first.
   */
  async findMyTasks(userId: string, query: any = {}) {
    const employee = await this.employeeModel.findOne({ userId });
    if (!employee) return { data: [], total: 0 };

    const { page = 1, limit = 50, status, priority, search } = query;
    const filter: any = { assignedTo: employee._id };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (search) filter.title = { $regex: search, $options: 'i' };

    const total = await this.taskModel.countDocuments(filter);
    const tasks = await this.taskModel
      .find(filter)
      .populate('projectId', 'name')
      .populate('createdBy', 'name email')
      .sort({ deadline: 1, priority: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return { data: tasks, total, page: +page, limit: +limit };
  }

  async create(dto: CreateTaskDto, userId: string) {
    return this.taskModel.create({ ...dto, createdBy: userId });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.taskModel
      .findByIdAndUpdate(id, dto, { new: true })
      .populate({ path: 'assignedTo', populate: { path: 'userId', select: 'name email' } })
      .populate('projectId', 'name');
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async delete(id: string) {
    const task = await this.taskModel.findByIdAndDelete(id);
    if (!task) throw new NotFoundException('Task not found');
    return { message: 'Task deleted successfully' };
  }

  async getStats() {
    const total = await this.taskModel.countDocuments();
    const todo = await this.taskModel.countDocuments({ status: 'todo' });
    const inProgress = await this.taskModel.countDocuments({ status: 'in-progress' });
    const review = await this.taskModel.countDocuments({ status: 'review' });
    const completed = await this.taskModel.countDocuments({ status: 'completed' });
    const overdue = await this.taskModel.countDocuments({
      deadline: { $lt: new Date() },
      status: { $ne: 'completed' },
    });
    return { total, todo, inProgress, review, completed, overdue };
  }
}
