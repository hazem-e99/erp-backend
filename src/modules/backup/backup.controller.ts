import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as express from 'express';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BackupService, ActorContext } from './backup.service';
import { BackupSource } from './schemas/backup-record.schema';
import { RestoreDto, RestoreExistingDto } from './dto/restore.dto';
import { GoogleDriveStorage } from './storage/google-drive.storage';

function extractActor(req: express.Request): ActorContext {
  const u: any = (req as any).user ?? {};
  return {
    userId: u.userId ?? u._id?.toString?.() ?? '',
    userEmail: u.email ?? '',
    userName: u.name ?? u.email ?? 'unknown',
    ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip,
    userAgent: req.headers['user-agent'],
  };
}

@ApiTags('Backup')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('backup')
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    private readonly driveStorage: GoogleDriveStorage,
  ) {}

  @Post('export')
  @RequirePermissions('backup:export')
  @ApiOperation({ summary: 'Run a manual database export now' })
  async export(@Req() req: express.Request) {
    const actor = extractActor(req);
    const record = await this.backupService.runExport(BackupSource.MANUAL, actor);
    return {
      id: record._id?.toString(),
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      location: record.location,
      createdAt: (record as any).createdAt,
    };
  }

  @Get('list')
  @RequirePermissions('backup:list')
  @ApiOperation({ summary: 'List backup records' })
  async list() {
    const items = await this.backupService.listBackups();
    return {
      items: items.map((r) => ({
        id: r._id?.toString(),
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        sha256: r.sha256,
        source: r.source,
        location: r.location,
        status: r.status,
        errorMessage: r.errorMessage,
        createdAt: (r as any).createdAt,
        completedAt: r.completedAt,
      })),
    };
  }

  @Get('storage-status')
  @RequirePermissions('backup:list')
  @ApiOperation({ summary: 'Check if the configured storage driver is ready' })
  async storageStatus() {
    const drive = await this.driveStorage.getAccountInfo();
    return { driver: 'google-drive', ...drive };
  }

  @Get('download/:id')
  @RequirePermissions('backup:export')
  @ApiOperation({ summary: 'Download a backup archive' })
  async download(@Param('id') id: string, @Res() res: express.Response) {
    const { stream, record } = await this.backupService.downloadStream(id);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
    if (record.sizeBytes) res.setHeader('Content-Length', String(record.sizeBytes));
    stream.on('error', (err) => {
      res.destroy(err as Error);
    });
    stream.pipe(res);
  }

  @Delete(':id')
  @RequirePermissions('backup:delete')
  @ApiOperation({ summary: 'Delete a backup (local + remote)' })
  async delete(@Param('id') id: string, @Req() req: express.Response) {
    const actor = extractActor(req as unknown as express.Request);
    await this.backupService.deleteBackup(id, actor);
    return { success: true };
  }

  @Post('import')
  @RequirePermissions('backup:import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, file, cb) => {
          const suffix = crypto.randomBytes(4).toString('hex');
          cb(null, `erp-import-${Date.now()}-${suffix}-${path.basename(file.originalname)}`);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024 * 1024, // 5 GB
      },
      fileFilter: (_req, file, cb) => {
        if (!/\.(gz|archive\.gz)$/i.test(file.originalname)) {
          cb(new Error('Only .gz backup archives accepted'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @ApiOperation({ summary: 'Restore database from uploaded archive (destructive)' })
  async importUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: RestoreDto,
    @Req() req: express.Request,
  ) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    const actor = extractActor(req);
    try {
      await this.backupService.verifyPasswordAndPhrase(actor.userId, dto.password, dto.confirmPhrase);
    } catch (err) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      throw err;
    }
    const jobId = await this.backupService.startRestoreFromUpload(file.path, actor);
    return { jobId, status: 'running' };
  }

  @Post('import/existing')
  @RequirePermissions('backup:import')
  @ApiOperation({ summary: 'Restore from an existing backup record (destructive)' })
  async importExisting(@Body() dto: RestoreExistingDto, @Req() req: express.Request) {
    const actor = extractActor(req);
    await this.backupService.verifyPasswordAndPhrase(actor.userId, dto.password, dto.confirmPhrase);
    const jobId = await this.backupService.startRestoreFromRecord(dto.backupId, actor);
    return { jobId, status: 'running' };
  }

  @Get('import/:jobId')
  @RequirePermissions('backup:import')
  @ApiOperation({ summary: 'Poll restore job status' })
  async restoreStatus(@Param('jobId') jobId: string) {
    const job = this.backupService.getRestoreJob(jobId);
    return job;
  }
}
