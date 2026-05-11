import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SupportedCurrency, BASE_CURRENCY } from '../../finance/constants/currency.constants';

export type CommissionDocument = Commission & Document;

export enum CommissionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum CommissionSourceType {
  SUBSCRIPTION = 'subscription',
  PAYMENT = 'payment',
}

@Schema({ timestamps: true })
export class Commission {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId!: Types.ObjectId;

  @Prop({ required: true })
  employeeName!: string;

  @Prop({ required: true, enum: Object.values(CommissionSourceType) })
  sourceType!: string;

  @Prop({ type: Types.ObjectId, required: true })
  sourceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subscription', default: null })
  subscriptionId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Client', default: null })
  clientId!: Types.ObjectId | null;

  @Prop({ default: '' })
  clientName!: string;

  @Prop({ required: true, min: 0, max: 100 })
  percentage!: number;

  // The base (currency-converted) net amount used for the calculation
  @Prop({ required: true, min: 0 })
  baseSourceNetAmount!: number;

  // The commission amount (always in base currency)
  @Prop({ required: true, min: 0 })
  baseCommissionAmount!: number;

  @Prop({ default: BASE_CURRENCY, enum: Object.values(SupportedCurrency) })
  currency!: string;

  @Prop({ default: CommissionStatus.PENDING, enum: Object.values(CommissionStatus) })
  status!: string;

  // Month/year that the commission is allocated to in payroll. Set on approve.
  @Prop({ type: Number, default: null })
  payrollMonth!: number | null;

  @Prop({ type: Number, default: null })
  payrollYear!: number | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  approvedBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Expense', default: null })
  expenseId!: Types.ObjectId | null;

  @Prop({ default: '' })
  transferScreenshot!: string;

  @Prop({ default: '' })
  transactionNumber!: string;

  @Prop({ default: '' })
  notes!: string;
}

export const CommissionSchema = SchemaFactory.createForClass(Commission);

CommissionSchema.index({ employeeId: 1, status: 1 });
CommissionSchema.index({ status: 1, payrollMonth: 1, payrollYear: 1 });
CommissionSchema.index({ sourceType: 1, sourceId: 1 });
CommissionSchema.index({ subscriptionId: 1 });
CommissionSchema.index({ createdAt: -1 });
