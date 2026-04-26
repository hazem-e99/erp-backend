import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus, UploadedFiles, UseInterceptors, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SubscriptionsService } from '../services/subscriptions.service';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

@Controller('finance/subscriptions')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @RequirePermissions('finance:create')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.subscriptionsService.findAll(query);
  }

  @Get('metrics')
  @RequirePermissions('finance:read')
  getMetrics() {
    return this.subscriptionsService.getDashboardMetrics();
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('finance:update')
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.subscriptionsService.cancel(id, reason);
  }

  @Delete(':id')
  @RequirePermissions('finance:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptionsService.delete(id);
  }

  // ─── Documents ───────────────────────────────────────────────────────────

  @Get(':id/documents')
  @RequirePermissions('finance:read')
  listDocuments(@Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptionsService.listDocuments(id);
  }

  @Post(':id/documents')
  @RequirePermissions('finance:update')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  uploadDocuments(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser('_id') userId: string,
  ) {
    // Multer stores `originalname` as a Latin-1 string by default — non-ASCII
    // names (Arabic, accented Latin, CJK) come out as mojibake. Re-decode the
    // raw bytes as UTF-8 so the actual filename is preserved.
    const decoded = (files ?? []).map((f) => ({
      ...f,
      originalname: Buffer.from(f.originalname, 'latin1').toString('utf8'),
    }));
    return this.subscriptionsService.addDocuments(id, decoded as Express.Multer.File[], userId ?? null);
  }

  @Get(':id/documents/:docId')
  @RequirePermissions('finance:read')
  async streamDocument(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId', ParseObjectIdPipe) docId: string,
    @Res() res: Response,
  ) {
    const { stream, mimeType, originalName, sizeBytes } =
      await this.subscriptionsService.streamDocument(id, docId);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(sizeBytes));
    // RFC 5987: ASCII-safe fallback + UTF-8 encoded filename* for non-ASCII names.
    const asciiFallback = originalName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
    );
    stream.on('error', (err) => {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).end(err.message);
    });
    stream.pipe(res);
  }

  @Delete(':id/documents/:docId')
  @RequirePermissions('finance:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDocument(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId', ParseObjectIdPipe) docId: string,
  ) {
    return this.subscriptionsService.removeDocument(id, docId);
  }
}
