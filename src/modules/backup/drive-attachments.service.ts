import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { GoogleDriveStorage } from './storage/google-drive.storage';

@Injectable()
export class DriveAttachmentsService {
  constructor(
    private readonly drive: GoogleDriveStorage,
    private readonly config: ConfigService,
  ) {}

  async upload(
    file: Express.Multer.File,
    category: 'payroll' | 'commissions' | 'expenses' | 'payments',
  ): Promise<string> {
    if (!file?.buffer) throw new Error('Attachment buffer is missing');
    if (!(await this.drive.isConfigured())) {
      throw new PreconditionFailedException(
        'Google Drive is not connected. Connect it in Settings > Backup before uploading attachments.',
      );
    }
    const decodedName = this.decodeFilename(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${decodedName}`;
    const result = await this.drive.uploadAttachment(
      Readable.from(file.buffer),
      uniqueName,
      file.mimetype || 'application/octet-stream',
      category,
    );
    const signature = this.sign(result.remoteKey);
    return `/api/attachments/${result.remoteKey}/${signature}/${encodeURIComponent(decodedName)}`;
  }

  async open(fileId: string, signature: string) {
    if (!this.validSignature(fileId, signature)) {
      throw new ForbiddenException('Invalid attachment signature');
    }
    try {
      return await this.drive.openAttachment(fileId);
    } catch (error: any) {
      if (error?.code === 404) {
        throw new NotFoundException('Attachment not found');
      }
      throw error;
    }
  }

  private sign(fileId: string): string {
    const secret =
      this.config.get<string>('ATTACHMENT_SIGNING_SECRET') ||
      this.config.get<string>('JWT_SECRET', 'dev-secret-key-change-me');
    return createHmac('sha256', secret).update(fileId).digest('hex');
  }

  private validSignature(fileId: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(fileId));
    const actual = Buffer.from(signature || '');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private decodeFilename(name: string): string {
    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      return decoded.includes('\uFFFD') ? name : decoded;
    } catch {
      return name;
    }
  }
}
