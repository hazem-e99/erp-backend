import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { SupportedCurrency, BASE_CURRENCY } from '../constants/currency.constants';

export type ExpenseDocument = Expense & Document;

export enum ExpenseCategory {
  SALARIES = 'salaries',
  ADS = 'ads',
  BANK_FEES = 'bank_fees',
  TOOLS = 'tools',
  FREELANCERS = 'freelancers',
  OTHER = 'other',
}

@Schema({ timestamps: true })
export class Expense {
  @Prop({ required: true, min: 0.01 })
  amount!: number;

  @Prop({ default: BASE_CURRENCY, enum: Object.values(SupportedCurrency) })
  currency!: string;

  @Prop({ default: 1, min: 0.0001 })
  exchangeRate!: number;

  @Prop({ required: true, min: 0 })
  baseAmount!: number;

  @Prop({ required: true, enum: Object.values(ExpenseCategory) })
  category!: string;

  @Prop({ type: Date, required: true })
  date!: Date;

  @Prop({ required: true })
  description!: string;

  @Prop({ default: '' })
  attachmentUrl!: string;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);

ExpenseSchema.index({ date: -1 });
ExpenseSchema.index({ category: 1, date: -1 });
ExpenseSchema.index({ createdAt: -1 });
