import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PayrollReminderDocument = PayrollReminder & Document;

@Schema({ timestamps: true })
export class PayrollReminder {
  @Prop({ required: true, enum: ['all', 'intern'] })
  type: 'all' | 'intern';

  @Prop({ type: Types.ObjectId, ref: 'Employee', default: null })
  employeeId?: Types.ObjectId | null;

  @Prop({ required: true, min: 1, max: 31 })
  dayOfMonth: number;
}

export const PayrollReminderSchema = SchemaFactory.createForClass(PayrollReminder);

PayrollReminderSchema.index({ type: 1, employeeId: 1 }, { unique: true });
