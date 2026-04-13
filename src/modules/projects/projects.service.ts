import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

@Injectable()
export class ProjectsService {
  constructor(@InjectModel(Project.name) private projectModel: Model<ProjectDocument>) {}

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, search, status, clientId } = query;
    const filter: any = {};
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }
    if (status) filter.status = status;
    if (clientId) filter.clientId = clientId;

    const total = await this.projectModel.countDocuments(filter);
    const projects = await this.projectModel
      .find(filter)
      .populate('clientId', 'name company')
      .populate({ path: 'teamMembers', populate: { path: 'userId', select: 'name email' } })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
    return { data: projects, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const project = await this.projectModel
      .findById(id)
      .populate('clientId')
      .populate({ path: 'teamMembers', populate: { path: 'userId', select: 'name email' } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async create(dto: CreateProjectDto) {
    return this.projectModel.create(dto);
  }

  async update(id: string, dto: UpdateProjectDto) {
    const project = await this.projectModel.findByIdAndUpdate(id, dto, { new: true })
      .populate('clientId', 'name company');
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async delete(id: string) {
    const project = await this.projectModel.findByIdAndDelete(id);
    if (!project) throw new NotFoundException('Project not found');
    return { message: 'Project deleted successfully' };
  }

  async getStats() {
    const total = await this.projectModel.countDocuments();
    const active = await this.projectModel.countDocuments({ status: 'in-progress' });
    const completed = await this.projectModel.countDocuments({ status: 'completed' });
    const totalBudget = await this.projectModel.aggregate([
      { $group: { _id: null, total: { $sum: '$budget' }, spent: { $sum: '$spent' } } },
    ]);
    return {
      total, active, completed,
      totalBudget: totalBudget[0]?.total || 0,
      totalSpent: totalBudget[0]?.spent || 0,
    };
  }
}
