import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import { DriveAttachmentsService } from './drive-attachments.service';

@Controller('attachments')
export class DriveAttachmentsController {
  constructor(private readonly attachments: DriveAttachmentsService) {}

  @Get(':fileId/:signature/:filename')
  async open(
    @Param('fileId') fileId: string,
    @Param('signature') signature: string,
  ) {
    const { stream, mimeType, originalName, sizeBytes } =
      await this.attachments.open(fileId, signature);
    const encodedName = encodeURIComponent(originalName);
    return new StreamableFile(stream, {
      type: mimeType,
      length: sizeBytes || undefined,
      disposition: `inline; filename="attachment"; filename*=UTF-8''${encodedName}`,
    });
  }
}
