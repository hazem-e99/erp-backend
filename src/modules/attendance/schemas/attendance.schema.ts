import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AttendanceDocument = Attendance & Document;

@Schema({ timestamps: true })
export class Attendance {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ default: null })
  checkIn: Date;

  @Prop({ default: null })
  checkOut: Date;

  @Prop({ default: 0 })
  workingHours: number;

  @Prop({ default: 0 })
  lateMinutes: number;

  @Prop({ default: 0 })
  overtimeMinutes: number;

  @Prop({ default: 'present', enum: ['present', 'absent', 'half-day', 'holiday', 'weekend'] })
  status: string;

  @Prop({ default: null })
  notes: string;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);

// Compound index to prevent duplicate attendance per day
AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
