import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BackupRecordDocument = BackupRecord & Document;

export enum BackupSource {
  MANUAL = 'manual',
  SCHEDULED = 'scheduled',
}

export enum BackupLocation {
  LOCAL = 'local',
  GOOGLE_DRIVE = 'google-drive',
}

export enum BackupStatus {
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class BackupRecord {
  @Prop({ required: true })
  filename!: string;

  @Prop({ default: 0 })
  sizeBytes!: number;

  @Prop({ type: String, default: null })
  sha256!: string | null;

  @Prop({ required: true, enum: Object.values(BackupSource) })
  source!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  triggeredBy!: Types.ObjectId | null;

  @Prop({ required: true, enum: Object.values(BackupLocation) })
  location!: string;

  @Prop({ type: String, default: null })
  remoteKey!: string | null;

  @Prop({ required: true, enum: Object.values(BackupStatus), default: BackupStatus.RUNNING })
  status!: string;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;
}

export const BackupRecordSchema = SchemaFactory.createForClass(BackupRecord);
BackupRecordSchema.index({ createdAt: -1 });
BackupRecordSchema.index({ source: 1, createdAt: -1 });
