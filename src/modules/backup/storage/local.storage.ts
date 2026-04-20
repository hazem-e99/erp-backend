import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { IBackupStorage, StoredBackupInfo, UploadResult } from './storage.interface';

/**
 * Dev-only storage. Render free tier has no persistent disk, so this is NOT for production.
 */
@Injectable()
export class LocalStorage implements IBackupStorage {
  private readonly logger = new Logger(LocalStorage.name);
  private readonly dir: string;

  constructor(private readonly config: ConfigService) {
    this.dir = path.resolve(
      process.cwd(),
      this.config.get<string>('BACKUP_DIR', './uploads/backup'),
    );
    fs.mkdirSync(this.dir, { recursive: true });
  }

  driverName(): string {
    return 'local';
  }

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async upload(stream: Readable, filename: string): Promise<UploadResult> {
    const filePath = path.join(this.dir, filename);
    const writeStream = fs.createWriteStream(filePath);
    await pipeline(stream, writeStream);
    const stat = fs.statSync(filePath);
    this.logger.log(`Saved ${filename} (${stat.size} bytes) to ${filePath}`);
    return { remoteKey: filename, sizeBytes: stat.size };
  }

  async download(remoteKey: string): Promise<Readable> {
    const filePath = path.join(this.dir, remoteKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local backup not found: ${remoteKey}`);
    }
    return fs.createReadStream(filePath);
  }

  async delete(remoteKey: string): Promise<void> {
    const filePath = path.join(this.dir, remoteKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async list(): Promise<StoredBackupInfo[]> {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.archive.gz'))
      .map((f) => {
        const stat = fs.statSync(path.join(this.dir, f));
        return {
          id: f,
          filename: f,
          sizeBytes: stat.size,
          createdAt: stat.mtime,
        };
      });
  }
}
