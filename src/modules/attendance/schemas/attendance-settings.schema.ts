import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AttendanceSettingsDocument = AttendanceSettings & Document;

export type ShiftType = 'full-time' | 'part-time' | 'flexible';

@Schema({ timestamps: true })
export class AttendanceSettings {
  /**
   * Work start time in "HH:mm" format (24h), e.g. "09:00"
   * Ignored when shiftType is 'flexible'.
   */
  @Prop({ default: '09:00' })
  workStartTime: string;

  /**
   * Work end time in "HH:mm" format (24h), e.g. "17:00"
   * Used to compute standard hours automatically.
   * Ignored when shiftType is 'flexible'.
   */
  @Prop({ default: '17:00' })
  workEndTime: string;

  /**
   * Grace period in minutes before an employee is considered late.
   * e.g. 5 means they can arrive up to 5 minutes after workStartTime without penalty.
   */
  @Prop({ default: 5 })
  gracePeriodMinutes: number;

  /**
   * Standard daily working hours (used for overtime calculation).
   * Auto-computed from start/end when saved, but can be overridden.
   */
  @Prop({ default: 8 })
  standardHours: number;

  /**
   * Shift type:
   * - full-time: fixed start + end times, late is calculated
   * - part-time: fixed start + end times (shorter day), late is calculated
   * - flexible: no fixed start time, late is never marked
   */
  @Prop({ default: 'full-time', enum: ['full-time', 'part-time', 'flexible'] })
  shiftType: ShiftType;

  /** Human-readable label for this settings record */
  @Prop({ default: 'Default Work Schedule' })
  label: string;
}

export const AttendanceSettingsSchema = SchemaFactory.createForClass(AttendanceSettings);
