import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Reminder extends Document {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop({ type: Number, default: 0 })
  amount: number;

  @Prop({ required: true, type: Date })
  reminderDate: Date;

  @Prop({ type: [String], default: [] })
  reminderPeriods: string[]; // ['7days', '3days', '24hours', 'sameday']

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: [Date], default: [] })
  sentAt: Date[]; // Track when reminders were sent

  @Prop({ default: 'pending' })
  status: string; // 'pending', 'completed', 'cancelled'
}

export const ReminderSchema = SchemaFactory.createForClass(Reminder);
