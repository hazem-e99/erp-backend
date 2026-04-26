import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import archiver = require('archiver');
import * as crypto from 'crypto';
import { Writable } from 'stream';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/schemas/audit-log.schema';
import { ActorContext } from './backup.service';

@Injectable()
export class JsonExportService {
  private readonly logger = new Logger(JsonExportService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  buildFilename(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    return `erp-data-${stamp}.zip`;
  }

  private safeMongoHost(): string {
    const uri = this.config.get<string>('MONGO_URI', '');
    try {
      const u = new URL(uri);
      return `${u.hostname}${u.pathname || ''}`;
    } catch {
      return 'unknown';
    }
  }

  private async serializeCollection(
    modelName: string,
  ): Promise<{ collectionName: string; buffer: Buffer; count: number; sha256: string }> {
    const model = this.connection.model(modelName);
    const collectionName = model.collection.collectionName;
    const cursor = model.find({}).lean().cursor();

    const parts: string[] = ['[\n'];
    let count = 0;
    let first = true;
    for await (const doc of cursor) {
      const json = JSON.stringify(doc, null, 2);
      parts.push(first ? json : ',\n' + json);
      first = false;
      count++;
    }
    parts.push('\n]\n');

    const buffer = Buffer.from(parts.join(''), 'utf8');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    return { collectionName, buffer, count, sha256 };
  }

  async streamJsonArchive(output: Writable, actor: ActorContext): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const collections: Array<{ name: string; count: number; sha256: string; bytes: number }> = [];

    archive.on('warning', (err) => {
      this.logger.warn(`archiver warning: ${err.message}`);
    });

    const archiveErrored = new Promise<never>((_, reject) => {
      archive.on('error', (err) => reject(err));
    });
    const archiveDone = new Promise<void>((resolve) => {
      archive.on('end', () => resolve());
    });

    archive.pipe(output);

    const modelNames = [...this.connection.modelNames()].sort();

    for (const name of modelNames) {
      const { collectionName, buffer, count, sha256 } = await this.serializeCollection(name);
      archive.append(buffer, { name: `${collectionName}.json` });
      collections.push({ name: collectionName, count, sha256, bytes: buffer.length });
    }

    const manifest = {
      exportedAt: new Date().toISOString(),
      exportedBy: {
        userId: actor.userId,
        email: actor.userEmail,
        name: actor.userName,
      },
      database: this.safeMongoHost(),
      collections,
      notes:
        'Browsable snapshot of all collections as JSON. Not restorable via this system; use the .archive.gz backup for restore.',
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    await Promise.race([archive.finalize(), archiveErrored]);
    await Promise.race([archiveDone, archiveErrored]);

    try {
      await this.audit.logAction({
        userId: actor.userId,
        userEmail: actor.userEmail,
        userName: actor.userName,
        action: AuditAction.EXPORT,
        entity: AuditEntity.USER,
        description: 'Manual JSON data export downloaded',
        metadata: {
          collectionCount: collections.length,
          totalDocs: collections.reduce((s, c) => s + c.count, 0),
          totalBytes: collections.reduce((s, c) => s + c.bytes, 0),
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    } catch (err: any) {
      this.logger.warn(`audit log failed for JSON export: ${err?.message}`);
    }

    this.logger.log(
      `JSON export complete: ${collections.length} collections, ${collections.reduce((s, c) => s + c.count, 0)} docs`,
    );
  }
}
