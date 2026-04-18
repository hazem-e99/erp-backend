import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EmployeeDocument = Employee & Document;

@Schema({ timestamps: true })
export class Employee {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  employeeId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  emailAddress: string;

  @Prop({ default: null })
  age: number;

  @Prop({ required: true, default: 0 })
  baseSalary: number;

  @Prop({ default: 0 })
  maxKpi: number;

  @Prop({ required: true })
  dateOfJoining: Date;

  @Prop({ default: null })
  dateOfBirth: Date;

  @Prop({ default: null })
  address: string;

  @Prop({ default: null })
  emergencyContact: string;

  @Prop({ default: null })
  whatsappNumber: string;

  // Arrays for multi-select
  @Prop({ type: [String], default: [] })
  positions: string[];

  @Prop({ type: [String], default: [] })
  departments: string[];

  @Prop({ type: [String], default: [] })
  contractTypes: string[];

  @Prop({ default: 'active', enum: ['active', 'inactive', 'terminated'] })
  status: string;

  @Prop({ default: 22 })
  annualLeaves: number;

  @Prop({ default: 0 })
  usedLeaves: number;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);
