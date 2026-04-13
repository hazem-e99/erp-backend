import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AnnouncementDocument = Announcement & Document;

@Schema({ timestamps: true })
export class Announcement {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ required: true, enum: ['all', 'users', 'roles', 'departments', 'projects'] })
  targetType: string;

  @Prop({ type: [String], default: [] })
  targetIds: string[];

  @Prop({ default: 0 })
  recipientCount: number;

  @Prop({ default: 0 })
  readCount: number;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
