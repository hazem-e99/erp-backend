import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

export enum PaymentMethod {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  CREDIT_CARD = 'credit_card',
  CHEQUE = 'cheque',
  ONLINE = 'online',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Subscription', required: true })
  subscriptionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Installment', required: true })
  installmentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  clientId!: Types.ObjectId;

  @Prop({ required: true })
  clientName!: string;

  @Prop({ required: true, min: 0.01 })
  amount!: number;

  @Prop({ type: Date, required: true })
  paymentDate!: Date;

  @Prop({ required: true, enum: Object.values(PaymentMethod) })
  method!: string;

  @Prop({ default: '' })
  reference!: string;

  @Prop({ default: '' })
  notes!: string;

  // overflow amount applied to next installment(s)
  @Prop({ default: 0 })
  overpaymentAmount!: number;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ subscriptionId: 1 });
PaymentSchema.index({ installmentId: 1 });
PaymentSchema.index({ clientId: 1 });
PaymentSchema.index({ paymentDate: -1 });
PaymentSchema.index({ createdAt: -1 });
