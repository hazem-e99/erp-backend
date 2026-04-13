import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument, ALL_PERMISSIONS } from './schemas/role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async findAll() {
    return this.roleModel.find().sort({ createdAt: -1 });
  }

  async findById(id: string) {
    const role = await this.roleModel.findById(id);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(dto: CreateRoleDto) {
    const exists = await this.roleModel.findOne({ name: dto.name });
    if (exists) throw new ConflictException('Role name already exists');
    return this.roleModel.create(dto);
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.roleModel.findByIdAndUpdate(id, dto, { new: true });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async delete(id: string) {
    const role = await this.roleModel.findById(id);
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ConflictException('Cannot delete system role');
    await this.roleModel.findByIdAndDelete(id);
    // Remove role from all users
    await this.userModel.updateMany({ role: id }, { $set: { role: null } });
    return { message: 'Role deleted successfully' };
  }

  async assignRole(dto: AssignRoleDto) {
    const user = await this.userModel.findById(dto.userId);
    if (!user) throw new NotFoundException('User not found');
    const role = await this.roleModel.findById(dto.roleId);
    if (!role) throw new NotFoundException('Role not found');
    user.role = role._id as any;
    await user.save();
    return { message: 'Role assigned successfully' };
  }

  getAllPermissions() {
    return ALL_PERMISSIONS;
  }

  async seedDefaultRoles() {
    const adminExists = await this.roleModel.findOne({ name: 'Super Admin' });
    if (!adminExists) {
      await this.roleModel.create({
        name: 'Super Admin',
        description: 'Full access to all features',
        permissions: ['*'],
        isSystem: true,
      });
    }

    const employeeExists = await this.roleModel.findOne({ name: 'Employee' });
    if (!employeeExists) {
      await this.roleModel.create({
        name: 'Employee',
        description: 'Basic employee access',
        permissions: [
          'tasks:read', 'tasks:update',
          'attendance:read', 'attendance:create',
          'leaves:read', 'leaves:create',
          'dashboard:employee',
        ],
        isSystem: true,
      });
    }

    const managerExists = await this.roleModel.findOne({ name: 'Manager' });
    if (!managerExists) {
      await this.roleModel.create({
        name: 'Manager',
        description: 'Manager access with team management',
        permissions: [
          'users:read', 'employees:read',
          'clients:read', 'clients:create', 'clients:update',
          'projects:read', 'projects:create', 'projects:update',
          'tasks:read', 'tasks:create', 'tasks:update',
          'attendance:read', 'attendance:create',
          'leaves:read', 'leaves:create', 'leaves:approve',
          'payroll:read',
          'finance:read',
          'dashboard:admin', 'dashboard:employee',
        ],
        isSystem: true,
      });
    }

    const hrExists = await this.roleModel.findOne({ name: 'HR' });
    if (!hrExists) {
      await this.roleModel.create({
        name: 'HR',
        description: 'HR Manager with attendance, leave, analytics & export access',
        permissions: [
          'employees:read',
          'attendance:read',
          'leaves:read', 'leaves:approve',
          'hr:dashboard', 'hr:attendance', 'hr:leaves', 'hr:reports',
          'export:data', 'import:data',
          'dashboard:admin', 'dashboard:employee',
          'announcements:send',
        ],
        isSystem: true,
      });
    }
  }
}
