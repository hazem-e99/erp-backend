import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BackupConfigDocument = BackupConfig & Document;

/**
 * Singleton-style config doc. Only one row exists; service reads/writes via findOne + upsert.
 * Refresh token is stored AES-256-GCM encrypted with BACKUP_ENCRYPTION_KEY.
 */
@Schema({ timestamps: true })
export class BackupConfig {
  @Prop({ type: String, default: null })
  googleRefreshTokenEnc!: string | null;

  @Prop({ type: String, default: null })
  googleTokenIv!: string | null;

  @Prop({ type: String, default: null })
  googleTokenAuthTag!: string | null;

  @Prop({ type: String, default: null })
  googleAccountEmail!: string | null;

  @Prop({ type: String, default: null })
  driveFolderId!: string | null;

  @Prop({ type: Date, default: null })
  connectedAt!: Date | null;

  @Prop({ type: Date, default: null })
  lastScheduledRunAt!: Date | null;
}

export const BackupConfigSchema = SchemaFactory.createForClass(BackupConfig);
