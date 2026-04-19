import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SupportedCurrency, BASE_CURRENCY } from '../constants/currency.constants';

export type RevenueDocument = Revenue & Document;

export enum RevenueStatus {
  PENDING = 'pending',
  RECOGNIZED = 'recognized',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: true })
export class Revenue {
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

  @Prop({ type: Date, required: true })
  recognitionDate!: Date;

  @Prop({ default: RevenueStatus.PENDING, enum: Object.values(RevenueStatus) })
  status!: string;

  // month number within the subscription (1-based)
  @Prop({ required: true })
  periodMonth!: number;

  @Prop({ required: true })
  description!: string;
}

export const RevenueSchema = SchemaFactory.createForClass(Revenue);

RevenueSchema.index({ subscriptionId: 1 });
RevenueSchema.index({ recognitionDate: 1, status: 1 });
RevenueSchema.index({ clientId: 1 });
RevenueSchema.index({ createdAt: -1 });
