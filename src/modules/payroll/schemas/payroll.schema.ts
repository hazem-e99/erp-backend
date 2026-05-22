import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  SupportedCurrency,
  BASE_CURRENCY,
} from '../../finance/constants/currency.constants';

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
  commissions: number;

  @Prop({ default: 0 })
  deductions: number;

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
  baseCommissions!: number;

  @Prop({ default: 0, min: 0 })
  baseDeductions!: number;

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

  // ── Fixed Payroll Cycle fields (populated for payrolls generated after the refactor) ──

  /** First day of the payroll cycle (e.g. Apr 26) */
  @Prop({ default: null })
  cycleStart: Date;

  /** Last day of the payroll cycle (e.g. May 25) */
  @Prop({ default: null })
  cycleEnd: Date;

  /** Date salaries are paid out */
  @Prop({ default: null })
  paymentDate: Date;

  /** Calendar days in the full cycle */
  @Prop({ default: 0 })
  totalCycleDays: number;

  /** Salary days the employee was active (out of 30) */
  @Prop({ default: 0 })
  workedDays: number;

  /** baseSalary / 30 – in original currency */
  @Prop({ default: 0 })
  dailyRate: number;

  /** dailyRate × workedDays – in original currency */
  @Prop({ default: 0 })
  proratedBaseSalary: number;

  /** proratedBaseSalary × exchangeRate – in base currency */
  @Prop({ default: 0 })
  baseProratedBaseSalary: number;

  /** True when the employee did not cover the full cycle */
  @Prop({ default: false })
  isProrated: boolean;

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

  @Prop({ type: Types.ObjectId, ref: 'Expense', default: null })
  expenseId: Types.ObjectId;
}

export const PayrollSchema = SchemaFactory.createForClass(Payroll);

PayrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
