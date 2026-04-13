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

  @Prop({ default: 'announcement', enum: ['announcement', 'system', 'task', 'leave'] })
  type: string;

  @Prop({ type: Types.ObjectId, ref: 'Announcement', default: null })
  announcementId: Types.ObjectId;

  @Prop({ default: false, index: true })
  isRead: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
// Compound index for fast user queries
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
