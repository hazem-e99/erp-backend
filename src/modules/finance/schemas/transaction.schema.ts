import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true, enum: ['income', 'expense'] })
  type: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  category: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: Types.ObjectId, ref: 'Project', default: null })
  projectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', default: null })
  clientId: Types.ObjectId;

  @Prop({ default: null })
  reference: string;

  @Prop({ default: 'completed', enum: ['pending', 'completed', 'cancelled'] })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
