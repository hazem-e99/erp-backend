import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
  EXPORT = 'export',
  APPROVE = 'approve',
  REJECT = 'reject',
  GENERATE = 'generate',
  SEND = 'send',
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
}

export enum AuditEntity {
  USER = 'user',
  EMPLOYEE = 'employee',
  CLIENT = 'client',
  PROJECT = 'project',
  TASK = 'task',
  ATTENDANCE = 'attendance',
  LEAVE = 'leave',
  PAYROLL = 'payroll',
  PAYMENT = 'payment',
  EXPENSE = 'expense',
  REVENUE = 'revenue',
  SUBSCRIPTION = 'subscription',
  ANNOUNCEMENT = 'announcement',
  ROLE = 'role',
  DEPARTMENT = 'department',
  POSITION = 'position',
  REMINDER = 'reminder',
}

export enum AuditStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  userEmail!: string;

  @Prop({ required: true })
  userName!: string;

  @Prop({ required: true, enum: Object.values(AuditAction) })
  action!: string;

  @Prop({ required: true, enum: Object.values(AuditEntity) })
  entity!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  entityId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Object })
  oldData?: Record<string, any>;

  @Prop({ type: Object })
  newData?: Record<string, any>;

  @Prop()
  description?: string;

  @Prop({ required: true, default: AuditStatus.SUCCESS, enum: Object.values(AuditStatus) })
  status!: string;

  @Prop()
  errorMessage?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Indexes for faster queries
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ entity: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });
