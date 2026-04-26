import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SupportedCurrency, BASE_CURRENCY } from '../../finance/constants/currency.constants';

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

  // Salary in original currency
  @Prop({ required: true, default: 0 })
  baseSalary: number;

  // Max KPI in original currency
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

  // Currency fields for salary/KPI (single currency per employee)
  @Prop({ default: BASE_CURRENCY, enum: Object.values(SupportedCurrency) })
  currency!: string;

  @Prop({ default: 1, min: 0.0001, max: 10000 })
  exchangeRate!: number;

  // Base currency amounts (calculated from baseSalary * exchangeRate)
  @Prop({ required: true, min: 0 })
  baseBaseSalary!: number;

  // Base currency max KPI (calculated from maxKpi * exchangeRate)
  @Prop({ default: 0, min: 0 })
  baseMaxKpi!: number;

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

  @Prop({ default: null, enum: ['mobile_wallet', 'visa', 'bank_account', 'instapay', null] })
  paymentMethodType?: string | null;

  @Prop({ default: null })
  paymentMethodDetails?: string | null;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);
