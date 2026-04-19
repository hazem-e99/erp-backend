import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SupportedCurrency, BASE_CURRENCY } from '../constants/currency.constants';

export type InstallmentDocument = Installment & Document;

export enum InstallmentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  PARTIALLY_PAID = 'partially_paid',
}

@Schema({ timestamps: true })
export class Installment {
  @Prop({ type: Types.ObjectId, ref: 'Subscription', required: true })
  subscriptionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  clientId!: Types.ObjectId;

  @Prop({ required: true })
  clientName!: string;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ default: BASE_CURRENCY, enum: Object.values(SupportedCurrency) })
  currency!: string;

  @Prop({ default: 1, min: 0.0001 })
  exchangeRate!: number;

  @Prop({ required: true, min: 0 })
  baseAmount!: number;

  @Prop({ default: 0 })
  paidAmount!: number; // Always in base currency

  @Prop({ type: Date, required: true })
  dueDate!: Date;

  @Prop({ default: InstallmentStatus.PENDING, enum: Object.values(InstallmentStatus) })
  status!: string;

  @Prop({ default: 1 })
  installmentNumber!: number;

  @Prop({ default: 1 })
  totalInstallments!: number;

  @Prop({ type: Date, default: null })
  paidAt!: Date;

  @Prop({ default: false })
  reminderSent!: boolean;
}

export const InstallmentSchema = SchemaFactory.createForClass(Installment);

InstallmentSchema.index({ subscriptionId: 1, status: 1 });
InstallmentSchema.index({ clientId: 1 });
InstallmentSchema.index({ dueDate: 1, status: 1 });
InstallmentSchema.index({ createdAt: -1 });
