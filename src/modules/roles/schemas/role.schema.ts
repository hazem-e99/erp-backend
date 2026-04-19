import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoleDocument = Role & Document;

export const ALL_PERMISSIONS = [
  // Users
  'users:read', 'users:create', 'users:update', 'users:delete',
  // Employees
  'employees:read', 'employees:create', 'employees:update', 'employees:delete',
  // Clients
  'clients:read', 'clients:create', 'clients:update', 'clients:delete',
  // Projects
  'projects:read', 'projects:create', 'projects:update', 'projects:delete',
  // Tasks
  'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete',
  // Attendance
  'attendance:read', 'attendance:create', 'attendance:update', 'attendance:settings',
  // Leaves
  'leaves:read', 'leaves:create', 'leaves:approve',
  // Payroll
  'payroll:read', 'payroll:create', 'payroll:update',
  // Finance
  'finance:read', 'finance:create', 'finance:update', 'finance:delete', 'finance:delete-all',
  // Roles
  'roles:read', 'roles:create', 'roles:update', 'roles:delete',
  // Dashboard
  'dashboard:admin', 'dashboard:employee',
  // Announcements
  'announcements:send',
  // HR Module
  'hr:dashboard', 'hr:attendance', 'hr:leaves', 'hr:reports',
  // Audit
  'audit:read',
  // Departments
  'departments:read', 'departments:create', 'departments:update', 'departments:delete',
  // Positions
  'positions:read', 'positions:create', 'positions:update', 'positions:delete',
  // Contract Types
  'contract-types:read', 'contract-types:create', 'contract-types:update', 'contract-types:delete',
  // Reminders
  'reminders:read', 'reminders:create', 'reminders:update', 'reminders:delete',
  // Export / Import
  'export:data', 'import:data',
];

@Schema({ timestamps: true })
export class Role {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ default: false })
  isSystem: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
