import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SupportedCurrency, BASE_CURRENCY } from '../../finance/constants/currency.constants';

export type PayrollDocument = Payroll & Document;

@Schema({ timestamps: true })
export class Payroll {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  month: number;

  @Prop({ required: true })
  year: number;

  // Currency inherited from employee
  @Prop({ default: BASE_CURRENCY, enum: Object.values(SupportedCurrency) })
  currency!: string;

  @Prop({ default: 1, min: 0.0001, max: 10000 })
  exchangeRate!: number;

  // Original currency amounts
  @Prop({ required: true })
  baseSalary: number;

  @Prop({ default: 0 })
  bonuses: number;

  @Prop({ default: 0 })
  deductions: number;

  @Prop({ default: 0 })
  overtimePay: number;

  @Prop({ default: 0 })
  maxKpi: number;

  @Prop({ default: 0 })
  kpiPercentage: number;

  @Prop({ default: 0 })
  kpiAmount: number;

  // Base currency amounts (calculated)
  @Prop({ required: true, min: 0 })
  baseBaseSalary!: number;

  @Prop({ default: 0, min: 0 })
  baseBonuses!: number;

  @Prop({ default: 0, min: 0 })
  baseDeductions!: number;

  @Prop({ default: 0, min: 0 })
  baseOvertimePay!: number;

  @Prop({ default: 0, min: 0 })
  baseMaxKpi!: number;

  @Prop({ default: 0, min: 0 })
  baseKpiAmount!: number;

  // Net salary always in base currency (sum of all base amounts)
  @Prop({ default: 0 })
  netSalary: number;

  @Prop({ default: null })
  transferScreenshot: string;

  @Prop({ default: null })
  transactionNumber: string;

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

  @Prop({ default: false })
  isRecordedAsExpense: boolean;
}

export const PayrollSchema = SchemaFactory.createForClass(Payroll);

PayrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
