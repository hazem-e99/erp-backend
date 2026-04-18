import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SubscriptionDocument = Subscription & Document;

export enum PlanType {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  SEMI_ANNUAL = 'semi_annual',
}

export enum SubscriptionStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum InstallmentPlan {
  FULL = 'full',
  SPLIT_2 = 'split_2',
  CUSTOM = 'custom',
}

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  clientId!: Types.ObjectId;

  @Prop({ required: true })
  clientName!: string;

  @Prop({ required: true, enum: Object.values(PlanType) })
  planType!: string;

  @Prop({ required: true, min: 0 })
  totalPrice!: number;

  @Prop({ type: Date, required: true })
  startDate!: Date;

  @Prop({ type: Date, required: true })
  endDate!: Date;

  @Prop({ default: SubscriptionStatus.PENDING, enum: Object.values(SubscriptionStatus) })
  status!: string;

  @Prop({ default: InstallmentPlan.FULL, enum: Object.values(InstallmentPlan) })
  installmentPlan!: string;

  @Prop({ default: 0 })
  customInstallments!: number;

  @Prop({ default: 0 })
  paidAmount!: number;

  @Prop({ required: true })
  description!: string;

  @Prop({ default: null })
  cancelledAt!: Date;

  @Prop({ default: '' })
  cancelReason!: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

SubscriptionSchema.index({ clientId: 1, status: 1 });
SubscriptionSchema.index({ status: 1, endDate: 1 });
SubscriptionSchema.index({ createdAt: -1 });

SubscriptionSchema.virtual('remainingAmount').get(function () {
  return this.totalPrice - this.paidAmount;
});
