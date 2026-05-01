import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SupportedCurrency, BASE_CURRENCY } from '../../finance/constants/currency.constants';

export type EmployeeSettlementDocument = EmployeeSettlement & Document;

@Schema({ timestamps: true })
export class EmployeeSettlement {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  employeeName: string;

  @Prop({ required: true })
  employeeNumber: string;

  @Prop({ default: BASE_CURRENCY, enum: Object.values(SupportedCurrency) })
  currency!: string;

  @Prop({ default: 1, min: 0.0001, max: 10000 })
  exchangeRate!: number;

  @Prop({ required: true })
  terminationDate: Date;

  @Prop({ required: true })
  lastWorkingDay: Date;

  @Prop({ default: 0 })
  accruedSalary: number;

  @Prop({ default: 0 })
  bonuses: number;

  @Prop({ default: 0 })
  deductions: number;

  @Prop({ default: 0 })
  otherAdjustments: number;

  @Prop({ default: 0 })
  netSettlement: number;

  @Prop({ default: 0 })
  baseAccruedSalary: number;

  @Prop({ default: 0 })
  baseBonuses: number;

  @Prop({ default: 0 })
  baseDeductions: number;

  @Prop({ default: 0 })
  baseOtherAdjustments: number;

  @Prop({ default: 0 })
  baseNetSettlement: number;

  @Prop({ default: '' })
  notes: string;
}

export const EmployeeSettlementSchema = SchemaFactory.createForClass(EmployeeSettlement);
