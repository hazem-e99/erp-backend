import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Department, DepartmentDocument } from './schemas/department.schema';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectModel(Department.name) private departmentModel: Model<DepartmentDocument>,
  ) {}

  async create(dto: CreateDepartmentDto): Promise<Department> {
    const existing = await this.departmentModel.findOne({ name: dto.name });
    if (existing) {
      throw new ConflictException('Department with this name already exists');
    }
    const department = new this.departmentModel(dto);
    return department.save();
  }

  async findAll(): Promise<Department[]> {
    return this.departmentModel.find().sort({ name: 1 }).exec();
  }

  async findOne(id: string): Promise<Department> {
    const department = await this.departmentModel.findById(id);
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return department;
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    const department = await this.departmentModel.findByIdAndUpdate(id, dto, { new: true });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return department;
  }

  async remove(id: string): Promise<void> {
    const result = await this.departmentModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Department not found');
    }
  }
}
