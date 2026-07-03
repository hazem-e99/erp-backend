import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { DriveAttachmentsService } from './drive-attachments.service';
import { GoogleDriveStorage } from './storage/google-drive.storage';

describe('DriveAttachmentsService', () => {
  const drive = {
    isConfigured: jest.fn().mockResolvedValue(true),
    uploadAttachment: jest.fn(),
    openAttachment: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'ATTACHMENT_SIGNING_SECRET' ? 'test-attachment-secret' : fallback,
    ),
  };
  const service = new DriveAttachmentsService(
    drive as unknown as GoogleDriveStorage,
    config as unknown as ConfigService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('uploads a memory file and returns a signed backend URL', async () => {
    drive.uploadAttachment.mockResolvedValue({
      remoteKey: 'drive-file-id',
      sizeBytes: 3,
    });
    const file = {
      buffer: Buffer.from('abc'),
      originalname: 'receipt.pdf',
      mimetype: 'application/pdf',
    } as Express.Multer.File;

    const url = await service.upload(file, 'payments');

    expect(url).toMatch(
      /^\/api\/attachments\/drive-file-id\/[a-f0-9]{64}\/receipt\.pdf$/,
    );
    expect(drive.uploadAttachment).toHaveBeenCalledWith(
      expect.any(Readable),
      expect.stringMatching(/-receipt\.pdf$/),
      'application/pdf',
      'payments',
    );
  });

  it('accepts its signed URL and rejects a forged signature', async () => {
    drive.uploadAttachment.mockResolvedValue({
      remoteKey: 'drive-file-id',
      sizeBytes: 3,
    });
    drive.openAttachment.mockResolvedValue({
      stream: Readable.from('abc'),
      originalName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
    });
    const url = await service.upload(
      {
        buffer: Buffer.from('abc'),
        originalname: 'receipt.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File,
      'payments',
    );
    const [, , , fileId, signature] = url.split('/');

    await expect(service.open(fileId, signature)).resolves.toMatchObject({
      originalName: 'receipt.pdf',
    });
    await expect(service.open(fileId, 'forged')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
