import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PayrollDocument = Payroll & Document;

@Schema({ timestamps: true })
export class Payroll {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  month: number;

  @Prop({ required: true })
  year: number;

  @Prop({ required: true })
  baseSalary: number;

  @Prop({ default: 0 })
  bonuses: number;

  @Prop({ default: 0 })
  deductions: number;

  @Prop({ default: 0 })
  overtimePay: number;

  @Prop({ default: 0 })
  netSalary: number;

  @Prop({ default: 0 })
  workingDays: number;

  @Prop({ default: 0 })
  presentDays: number;

  @Prop({ default: 'draft', enum: ['draft', 'processed', 'paid'] })
  status: string;

  @Prop({ default: null })
  paidAt: Date;

  @Prop({ default: '' })
  notes: string;

  @Prop({ type: Object, default: {} })
  breakdown: Record<string, any>;
}

export const PayrollSchema = SchemaFactory.createForClass(Payroll);

PayrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
