import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  BackupRecord,
  BackupRecordDocument,
  BackupLocation,
  BackupSource,
  BackupStatus,
} from './schemas/backup-record.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/schemas/audit-log.schema';
import { BACKUP_STORAGE } from './storage/storage.interface';
import type { IBackupStorage } from './storage/storage.interface';
import { MaintenanceLockService } from './maintenance-lock.service';

export interface ActorContext {
  userId: string;
  userEmail: string;
  userName: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RestoreJobState {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  filename: string;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly restoreJobs = new Map<string, RestoreJobState>();

  constructor(
    private readonly config: ConfigService,
    @InjectModel(BackupRecord.name)
    private readonly backupRecordModel: Model<BackupRecordDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(BACKUP_STORAGE)
    private readonly storage: IBackupStorage,
    private readonly audit: AuditService,
    private readonly lock: MaintenanceLockService,
  ) {}

  private mongoUri(): string {
    const uri = this.config.get<string>('MONGO_URI');
    if (!uri) throw new InternalServerErrorException('MONGO_URI not configured');
    return uri;
  }

  private dumpBinary(): string {
    return this.config.get<string>('MONGODUMP_BIN', 'mongodump');
  }

  private restoreBinary(): string {
    return this.config.get<string>('MONGORESTORE_BIN', 'mongorestore');
  }

  private buildFilename(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    const rand = crypto.randomBytes(3).toString('hex');
    return `erp-backup-${stamp}-${rand}.archive.gz`;
  }

  async runExport(
    source: BackupSource,
    actor: ActorContext | null,
  ): Promise<BackupRecordDocument> {
    const filename = this.buildFilename();

    const record = await this.backupRecordModel.create({
      filename,
      source,
      location: this.storage.driverName(),
      status: BackupStatus.RUNNING,
      triggeredBy: actor ? new Types.ObjectId(actor.userId) : null,
    });

    const dumpArgs = [
      `--uri=${this.mongoUri()}`,
      '--archive',
      '--gzip',
      '--quiet',
    ];
    const child = spawn(this.dumpBinary(), dumpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    const hash = crypto.createHash('sha256');
    const sizeTracker = new PassThrough();
    let sizeBytes = 0;

    sizeTracker.on('data', (chunk: Buffer) => {
      sizeBytes += chunk.length;
      hash.update(chunk);
    });

    let stderrBuf = '';
    child.stderr.on('data', (d) => {
      stderrBuf += d.toString();
    });

    child.stdout.pipe(sizeTracker);

    const childExit = new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mongodump exited with code ${code}: ${stderrBuf.slice(-500)}`));
      });
    });

    let uploadResult;
    try {
      const [up] = await Promise.all([
        this.storage.upload(sizeTracker, filename, 'application/gzip'),
        childExit,
      ]);
      uploadResult = up;
    } catch (err: any) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      record.status = BackupStatus.FAILED;
      record.errorMessage = err?.message ?? 'unknown error';
      record.completedAt = new Date();
      await record.save();

      if (actor) {
        await this.audit.logFailure({
          userId: actor.userId,
          userEmail: actor.userEmail,
          userName: actor.userName,
          action: AuditAction.EXPORT,
          entity: AuditEntity.USER,
          entityId: record._id?.toString(),
          errorMessage: err?.message ?? 'backup failed',
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
      }
      throw new InternalServerErrorException(`Backup failed: ${err?.message ?? err}`);
    }

    record.sha256 = hash.digest('hex');
    record.sizeBytes = uploadResult.sizeBytes || sizeBytes;
    record.remoteKey = uploadResult.remoteKey;
    record.status = BackupStatus.SUCCEEDED;
    record.completedAt = new Date();
    await record.save();

    if (actor) {
      await this.audit.logAction({
        userId: actor.userId,
        userEmail: actor.userEmail,
        userName: actor.userName,
        action: AuditAction.EXPORT,
        entity: AuditEntity.USER,
        entityId: record._id?.toString(),
        description: `Database backup created (${source})`,
        metadata: {
          filename,
          sizeBytes: record.sizeBytes,
          sha256: record.sha256,
          location: record.location,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    this.logger.log(
      `Export complete: ${filename} size=${record.sizeBytes} sha256=${record.sha256?.slice(0, 12)}…`,
    );
    return record;
  }

  async listBackups(): Promise<BackupRecordDocument[]> {
    return this.backupRecordModel.find().sort({ createdAt: -1 }).limit(200).exec();
  }

  async findById(id: string): Promise<BackupRecordDocument> {
    const rec = await this.backupRecordModel.findById(id).exec();
    if (!rec) throw new NotFoundException('Backup record not found');
    return rec;
  }

  async downloadStream(id: string): Promise<{ stream: Readable; record: BackupRecordDocument }> {
    const record = await this.findById(id);
    if (!record.remoteKey) throw new NotFoundException('Backup has no remote key');
    const stream = await this.storage.download(record.remoteKey);
    return { stream, record };
  }

  async deleteBackup(id: string, actor: ActorContext): Promise<void> {
    const record = await this.findById(id);
    if (record.remoteKey) {
      try {
        await this.storage.delete(record.remoteKey);
      } catch (err: any) {
        this.logger.warn(`Storage delete failed for ${record.filename}: ${err?.message}`);
      }
    }
    await this.backupRecordModel.deleteOne({ _id: record._id }).exec();

    await this.audit.logAction({
      userId: actor.userId,
      userEmail: actor.userEmail,
      userName: actor.userName,
      action: AuditAction.DELETE,
      entity: AuditEntity.USER,
      entityId: record._id?.toString(),
      description: `Deleted backup ${record.filename}`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  async verifyPasswordAndPhrase(userId: string, password: string, phrase: string): Promise<void> {
    const expected = this.config.get<string>(
      'BACKUP_RESTORE_PHRASE',
      'RESTORE PRODUCTION DATABASE',
    );
    if (phrase.trim() !== expected) {
      throw new BadRequestException('Confirmation phrase does not match');
    }
    const user = await this.userModel.findById(userId).select('+password').exec();
    if (!user) throw new UnauthorizedException('User not found');
    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Password is incorrect');
  }

  private async streamToTempFile(input: Readable): Promise<{ filePath: string; sha256: string; sizeBytes: number }> {
    const tmpPath = path.join(os.tmpdir(), `erp-restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.archive.gz`);
    const hash = crypto.createHash('sha256');
    let sizeBytes = 0;
    const write = fs.createWriteStream(tmpPath);
    input.on('data', (chunk: Buffer) => {
      sizeBytes += chunk.length;
      hash.update(chunk);
    });
    await pipeline(input, write);
    return { filePath: tmpPath, sha256: hash.digest('hex'), sizeBytes };
  }

  /**
   * Restore from an uploaded file (already written to tmp by multer) or from an existing backup id.
   * Returns a job id the client polls.
   */
  async startRestoreFromUpload(
    uploadedPath: string,
    actor: ActorContext,
  ): Promise<string> {
    const allowForeign = this.config.get<string>('BACKUP_ALLOW_FOREIGN', 'false') === 'true';
    const hash = crypto.createHash('sha256');
    let sizeBytes = 0;
    await pipeline(
      fs.createReadStream(uploadedPath),
      new PassThrough({
        transform(chunk, _enc, cb) {
          sizeBytes += chunk.length;
          hash.update(chunk);
          cb(null, chunk);
        },
      }),
    );
    const sha256 = hash.digest('hex');

    if (!allowForeign) {
      const known = await this.backupRecordModel.findOne({ sha256, status: BackupStatus.SUCCEEDED }).exec();
      if (!known) {
        try { fs.unlinkSync(uploadedPath); } catch { /* ignore */ }
        throw new BadRequestException(
          'Uploaded file does not match any known backup (SHA-256 mismatch). Set BACKUP_ALLOW_FOREIGN=true to bypass.',
        );
      }
    }

    return this.launchRestoreJob(uploadedPath, path.basename(uploadedPath), sha256, sizeBytes, actor, true);
  }

  async startRestoreFromRecord(backupId: string, actor: ActorContext): Promise<string> {
    const record = await this.findById(backupId);
    if (!record.remoteKey) throw new NotFoundException('Backup has no remote key');
    if (record.status !== BackupStatus.SUCCEEDED) {
      throw new ConflictException('Cannot restore from a non-succeeded backup');
    }
    const download = await this.storage.download(record.remoteKey);
    const { filePath, sha256, sizeBytes } = await this.streamToTempFile(download);

    if (record.sha256 && sha256 !== record.sha256) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      throw new ConflictException('Downloaded archive SHA-256 mismatch — corruption detected');
    }

    return this.launchRestoreJob(filePath, record.filename, sha256, sizeBytes, actor, true);
  }

  getRestoreJob(jobId: string): RestoreJobState {
    const j = this.restoreJobs.get(jobId);
    if (!j) throw new NotFoundException('Restore job not found');
    return j;
  }

  private launchRestoreJob(
    filePath: string,
    filename: string,
    sha256: string,
    _sizeBytes: number,
    actor: ActorContext,
    cleanupTmp: boolean,
  ): string {
    if (!this.lock.acquire(`Restore in progress: ${filename}`)) {
      throw new ConflictException('Another maintenance operation is already running');
    }

    const jobId = crypto.randomUUID();
    const job: RestoreJobState = {
      id: jobId,
      status: 'running',
      filename,
      startedAt: new Date(),
    };
    this.restoreJobs.set(jobId, job);

    // Kick off restore asynchronously
    (async () => {
      const restoreArgs = [
        `--uri=${this.mongoUri()}`,
        '--archive',
        '--gzip',
        '--drop',
        '--quiet',
      ];

      const child = spawn(this.restoreBinary(), restoreArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderrBuf = '';
      child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

      try {
        await this.audit.logAction({
          userId: actor.userId,
          userEmail: actor.userEmail,
          userName: actor.userName,
          action: AuditAction.UPLOAD,
          entity: AuditEntity.USER,
          description: `Database RESTORE started: ${filename}`,
          metadata: { sha256, filename },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });

        const childExit = new Promise<void>((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`mongorestore exited with code ${code}: ${stderrBuf.slice(-500)}`));
          });
        });

        await Promise.all([
          pipeline(fs.createReadStream(filePath), child.stdin),
          childExit,
        ]);

        job.status = 'succeeded';
        job.finishedAt = new Date();

        await this.audit.logAction({
          userId: actor.userId,
          userEmail: actor.userEmail,
          userName: actor.userName,
          action: AuditAction.UPLOAD,
          entity: AuditEntity.USER,
          description: `Database RESTORE succeeded: ${filename}`,
          metadata: { sha256, filename },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
      } catch (err: any) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        job.status = 'failed';
        job.error = err?.message ?? 'restore failed';
        job.finishedAt = new Date();
        this.logger.error(`Restore failed: ${job.error}`);
        await this.audit.logFailure({
          userId: actor.userId,
          userEmail: actor.userEmail,
          userName: actor.userName,
          action: AuditAction.UPLOAD,
          entity: AuditEntity.USER,
          errorMessage: job.error ?? 'restore failed',
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
      } finally {
        this.lock.release();
        if (cleanupTmp) {
          try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        }
      }
    })().catch((e) => this.logger.error(`Restore job runaway error: ${e?.message}`));

    return jobId;
  }
}
