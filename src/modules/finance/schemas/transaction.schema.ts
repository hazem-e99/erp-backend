/**
 * Legacy Transaction schema stub — kept for backward compatibility with DashboardService.
 * New code should use Payment, Expense, and Revenue schemas directly.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

@Schema({ timestamps: true, collection: 'transactions' })
export class Transaction {
  @Prop({ required: true })
  type!: string; // 'income' | 'expense'

  @Prop({ required: true })
  amount!: number;

  @Prop({ default: 'completed' })
  status!: string;

  @Prop({ type: Date })
  date!: Date;

  @Prop({ default: '' })
  description!: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
