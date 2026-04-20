import {
  Controller,
  ForbiddenException,
  Headers,
  Injectable,
  Logger,
  Post,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BackupService } from './backup.service';
import { BackupSource, BackupRecord, BackupRecordDocument, BackupStatus } from './schemas/backup-record.schema';
import { BackupConfig, BackupConfigDocument } from './schemas/backup-config.schema';
import { BACKUP_STORAGE } from './storage/storage.interface';
import type { IBackupStorage } from './storage/storage.interface';
import { Inject } from '@nestjs/common';

const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h guard against double runs

@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(
    private readonly backupService: BackupService,
    private readonly config: ConfigService,
    @InjectModel(BackupRecord.name)
    private readonly backupRecordModel: Model<BackupRecordDocument>,
    @InjectModel(BackupConfig.name)
    private readonly backupConfigModel: Model<BackupConfigDocument>,
    @Inject(BACKUP_STORAGE)
    private readonly storage: IBackupStorage,
  ) {}

  /** Fallback cron in case the server is awake at 02:00 UTC. External trigger is primary. */
  @Cron('0 2 * * *')
  async nightlyTick() {
    await this.runIfDue('internal-cron');
  }

  /** Core scheduled run — idempotent within MIN_INTERVAL_MS. */
  async runIfDue(triggerSource: string): Promise<{ ran: boolean; reason?: string; recordId?: string }> {
    const cfg = await this.backupConfigModel.findOne().exec();
    const last = cfg?.lastScheduledRunAt?.getTime?.() ?? 0;
    const now = Date.now();
    if (now - last < MIN_INTERVAL_MS) {
      this.logger.log(`Skipping scheduled backup — last run ${Math.round((now - last) / 60000)}m ago`);
      return { ran: false, reason: 'too-soon' };
    }

    if (!(await this.storage.isConfigured())) {
      this.logger.warn(`Scheduled backup skipped — storage driver '${this.storage.driverName()}' not configured`);
      return { ran: false, reason: 'storage-not-configured' };
    }

    this.logger.log(`Running scheduled backup (trigger=${triggerSource})…`);
    await this.backupConfigModel.findOneAndUpdate(
      {},
      { lastScheduledRunAt: new Date() },
      { upsert: true },
    );

    try {
      const record = await this.backupService.runExport(BackupSource.SCHEDULED, null);
      await this.runRetentionPrune();
      return { ran: true, recordId: record._id?.toString() };
    } catch (err: any) {
      this.logger.error(`Scheduled backup failed: ${err?.message}`);
      return { ran: false, reason: `error: ${err?.message}` };
    }
  }

  /**
   * Retention: keep last N daily + last N weekly (Sunday) + last N monthly (1st-of-month).
   * Prunes BackupRecord + the remote file.
   */
  async runRetentionPrune(): Promise<{ deleted: number }> {
    const daily = Number(this.config.get('BACKUP_RETENTION_DAILY', 7));
    const weekly = Number(this.config.get('BACKUP_RETENTION_WEEKLY', 4));
    const monthly = Number(this.config.get('BACKUP_RETENTION_MONTHLY', 6));

    const records = await this.backupRecordModel
      .find({ status: BackupStatus.SUCCEEDED, source: BackupSource.SCHEDULED })
      .sort({ createdAt: -1 })
      .exec();

    const keep = new Set<string>();
    const dailyIds = records.slice(0, daily).map((r) => r._id?.toString() ?? '');
    dailyIds.forEach((id) => keep.add(id));

    const weeklyBuckets = new Map<string, string>();
    for (const r of records) {
      const d = new Date((r as any).createdAt as Date);
      // Bucket by ISO week (UTC)
      const week = this.isoWeek(d);
      if (!weeklyBuckets.has(week)) weeklyBuckets.set(week, r._id?.toString() ?? '');
      if (weeklyBuckets.size >= weekly) break;
    }
    weeklyBuckets.forEach((id) => keep.add(id));

    const monthlyBuckets = new Map<string, string>();
    for (const r of records) {
      const d = new Date((r as any).createdAt as Date);
      const month = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
      if (!monthlyBuckets.has(month)) monthlyBuckets.set(month, r._id?.toString() ?? '');
      if (monthlyBuckets.size >= monthly) break;
    }
    monthlyBuckets.forEach((id) => keep.add(id));

    const toDelete = records.filter((r) => !keep.has(r._id?.toString() ?? ''));
    let deleted = 0;
    for (const r of toDelete) {
      try {
        if (r.remoteKey) await this.storage.delete(r.remoteKey);
        await this.backupRecordModel.deleteOne({ _id: r._id }).exec();
        deleted++;
      } catch (err: any) {
        this.logger.warn(`Retention prune failed for ${r.filename}: ${err?.message}`);
      }
    }
    this.logger.log(`Retention prune: deleted ${deleted}, kept ${records.length - deleted}`);
    return { deleted };
  }

  private isoWeek(d: Date): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${t.getUTCFullYear()}-W${week}`;
  }
}

/**
 * Public endpoint the GitHub Actions / cron-job.org hits daily to wake the server
 * and run the scheduled backup. Auth is a shared bearer token (BACKUP_TRIGGER_SECRET),
 * NOT JWT — external services can't mint JWTs.
 */
@ApiTags('Backup')
@Controller('backup')
export class BackupTriggerController {
  private readonly logger = new Logger(BackupTriggerController.name);
  constructor(
    private readonly scheduler: BackupScheduler,
    private readonly config: ConfigService,
  ) {}

  @Post('scheduled-run')
  @ApiOperation({ summary: 'External trigger for daily backup (shared secret)' })
  async scheduledRun(@Headers('authorization') authHeader: string) {
    const expected = this.config.get<string>('BACKUP_TRIGGER_SECRET');
    if (!expected) {
      throw new ForbiddenException('Scheduled trigger disabled — BACKUP_TRIGGER_SECRET not set');
    }
    const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim();
    // timingSafeEqual: constant-time comparison
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    const ok =
      a.length === b.length &&
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('crypto').timingSafeEqual(a, b);
    if (!ok) {
      throw new ForbiddenException('Invalid trigger token');
    }
    return this.scheduler.runIfDue('external-cron');
  }
}
