import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({
    default: 'announcement',
    enum: [
      'announcement',
      'system',
      'task',
      'leave',
      'payroll',
      'installment',
      'payment',
    ],
  })
  type: string;

  @Prop({ type: Types.ObjectId, ref: 'Announcement', default: null })
  announcementId: Types.ObjectId;

  /** Optional link the UI can navigate to when the notification is clicked. */
  @Prop({ type: String, default: null })
  link: string | null;

  /**
   * Stable key used to deduplicate scheduled system notifications so the
   * scheduler can fire the same reminder hour after hour without spamming.
   * Format examples: "payroll-due:2026-05:7d", "installment-due:<id>:3d".
   */
  @Prop({ type: String, default: null, index: true })
  dedupKey: string | null;

  @Prop({ default: false, index: true })
  isRead: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
// Compound index for fast user queries
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
