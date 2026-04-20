import { Readable } from 'stream';

export interface StoredBackupInfo {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface UploadResult {
  remoteKey: string;
  sizeBytes: number;
}

/**
 * Storage driver abstraction. Concrete drivers: LocalStorage (dev), GoogleDriveStorage (prod).
 * All uploads MUST be stream-based — Render has no persistent disk for staging large archives.
 */
export interface IBackupStorage {
  driverName(): string;
  isConfigured(): Promise<boolean>;
  upload(stream: Readable, filename: string, mimeType: string): Promise<UploadResult>;
  download(remoteKey: string): Promise<Readable>;
  delete(remoteKey: string): Promise<void>;
  list(): Promise<StoredBackupInfo[]>;
}

export const BACKUP_STORAGE = 'BACKUP_STORAGE';
