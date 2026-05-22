import {
  Injectable,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
  PreconditionFailedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Readable, PassThrough } from 'stream';
import {
  BackupConfig,
  BackupConfigDocument,
} from '../schemas/backup-config.schema';
import { TokenCryptoService } from '../token-crypto.service';
import {
  IBackupStorage,
  StoredBackupInfo,
  UploadResult,
} from './storage.interface';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

@Injectable()
export class GoogleDriveStorage implements IBackupStorage, OnModuleInit {
  private readonly logger = new Logger(GoogleDriveStorage.name);

  onModuleInit() {
    const required = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'GOOGLE_DRIVE_FOLDER_NAME',
      'FRONTEND_URL',
    ];
    const missing = required.filter((k) => !this.config.get<string>(k));
    if (missing.length) {
      this.logger.warn(
        `Google Drive / OAuth env vars not set: ${missing.join(', ')}. ` +
          'Google Drive backup and OAuth will not work until these are configured.',
      );
    }
  }

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: TokenCryptoService,
    @InjectModel(BackupConfig.name)
    private readonly backupConfigModel: Model<BackupConfigDocument>,
  ) {}

  driverName(): string {
    return 'google-drive';
  }

  async isConfigured(): Promise<boolean> {
    const cfg = await this.backupConfigModel.findOne().exec();
    return !!(cfg && cfg.googleRefreshTokenEnc);
  }

  buildOAuthClient(): OAuth2Client {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.config.get<string>('GOOGLE_REDIRECT_URI');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new InternalServerErrorException(
        'Google OAuth env vars missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI)',
      );
    }
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  generateAuthUrl(state: string): string {
    const client = this.buildOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DRIVE_SCOPE],
      state,
    });
  }

  async exchangeCodeAndPersist(
    code: string,
  ): Promise<{ email: string | null }> {
    const client = this.buildOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new InternalServerErrorException(
        'Google did not return a refresh_token. Revoke the app at https://myaccount.google.com/permissions and reconnect.',
      );
    }

    client.setCredentials(tokens);

    let email: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const userinfo = await oauth2.userinfo.get();
      email = userinfo.data.email ?? null;
    } catch {
      // email lookup is optional
    }

    const folderId = await this.ensureFolderId(client);
    const enc = this.crypto.encrypt(tokens.refresh_token);

    await this.backupConfigModel.findOneAndUpdate(
      {},
      {
        googleRefreshTokenEnc: enc.ciphertext,
        googleTokenIv: enc.iv,
        googleTokenAuthTag: enc.authTag,
        googleAccountEmail: email,
        driveFolderId: folderId,
        connectedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    return { email };
  }

  async disconnect(): Promise<void> {
    await this.backupConfigModel.findOneAndUpdate(
      {},
      {
        googleRefreshTokenEnc: null,
        googleTokenIv: null,
        googleTokenAuthTag: null,
        googleAccountEmail: null,
        driveFolderId: null,
        connectedAt: null,
      },
      { upsert: true },
    );
    this.cachedSubscriptionDocsFolderId = null;
  }

  async getAccountInfo(): Promise<{
    connected: boolean;
    email: string | null;
    folderId: string | null;
    connectedAt: Date | null;
  }> {
    const cfg = await this.backupConfigModel.findOne().exec();
    return {
      connected: !!(cfg && cfg.googleRefreshTokenEnc),
      email: cfg?.googleAccountEmail ?? null,
      folderId: cfg?.driveFolderId ?? null,
      connectedAt: cfg?.connectedAt ?? null,
    };
  }

  private async getAuthedClient(): Promise<OAuth2Client> {
    const cfg = await this.backupConfigModel.findOne().exec();
    if (
      !cfg ||
      !cfg.googleRefreshTokenEnc ||
      !cfg.googleTokenIv ||
      !cfg.googleTokenAuthTag
    ) {
      throw new InternalServerErrorException(
        'Google Drive is not connected. Connect it from Settings → Backup first.',
      );
    }
    const refreshToken = this.crypto.decrypt({
      ciphertext: cfg.googleRefreshTokenEnc,
      iv: cfg.googleTokenIv,
      authTag: cfg.googleTokenAuthTag,
    });
    const client = this.buildOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  private driveClient(auth: OAuth2Client): drive_v3.Drive {
    return google.drive({ version: 'v3', auth });
  }

  private isInvalidGrantError(err: any): boolean {
    return (
      err?.response?.data?.error === 'invalid_grant' ||
      err?.errors?.some?.((e: any) => e?.reason === 'invalidGrant') ||
      String(err?.message ?? '')
        .toLowerCase()
        .includes('invalid_grant')
    );
  }

  private async throwIfInvalidGrant(err: any): Promise<void> {
    if (this.isInvalidGrantError(err)) {
      this.logger.warn(
        'Stored Google Drive refresh token is invalid; disconnecting Drive.',
      );
      await this.disconnect();
      throw new PreconditionFailedException({
        message:
          'Google Drive connection expired or was revoked. Reconnect Google Drive in Settings > Backup, then upload the document again.',
        code: 'GOOGLE_DRIVE_RECONNECT_REQUIRED',
      });
    }
  }

  private async ensureFolderId(
    auth: OAuth2Client,
    folderName?: string,
  ): Promise<string> {
    const name =
      folderName ??
      this.config.get<string>('GOOGLE_DRIVE_FOLDER_NAME', 'ERP-Backups');
    const drive = this.driveClient(auth);

    const existing = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${name.replace(/'/g, "\\'")}'`,
      fields: 'files(id,name)',
      pageSize: 1,
    });
    if (
      existing.data.files &&
      existing.data.files.length > 0 &&
      existing.data.files[0].id
    ) {
      return existing.data.files[0].id;
    }

    const created = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    if (!created.data.id) {
      throw new InternalServerErrorException(
        'Failed to create Google Drive folder',
      );
    }
    return created.data.id;
  }

  private async ensureBackupFolderId(auth: OAuth2Client): Promise<string> {
    const cfg = await this.backupConfigModel.findOne().exec();
    const drive = this.driveClient(auth);

    // Verify existing saved folder ID still exists in Drive
    if (cfg?.driveFolderId) {
      try {
        const check = await drive.files.get({
          fileId: cfg.driveFolderId,
          fields: 'id,trashed',
        });
        if (check.data.id && !check.data.trashed) {
          return cfg.driveFolderId;
        }
      } catch (err: any) {
        if (err?.code !== 404) {
          this.logger.warn(`Backup folder verify failed: ${err.message}`);
        }
      }
    }

    // Saved ID was invalid/missing — search or create
    const folderId = await this.ensureFolderId(auth);
    await this.backupConfigModel.findOneAndUpdate(
      {},
      { driveFolderId: folderId },
      { upsert: true },
    );
    this.logger.log(`Backup folder resolved: ${folderId}`);
    return folderId;
  }

  private cachedSubscriptionDocsFolderId: string | null = null;
  private subscriptionDocsFolderPromise: Promise<string> | null = null;

  private async ensureSubscriptionDocsFolderId(): Promise<string> {
    if (this.cachedSubscriptionDocsFolderId) {
      return this.cachedSubscriptionDocsFolderId;
    }
    if (this.subscriptionDocsFolderPromise) {
      return this.subscriptionDocsFolderPromise;
    }

    this.subscriptionDocsFolderPromise = (async () => {
      const cfg = await this.backupConfigModel.findOne().exec();
      if (cfg?.subscriptionDocsFolderId) {
        // Verify the persisted folder still exists in Drive (user may have deleted it).
        const auth = await this.getAuthedClient();
        const drive = this.driveClient(auth);
        try {
          const check = await drive.files.get({
            fileId: cfg.subscriptionDocsFolderId,
            fields: 'id,trashed',
          });
          if (check.data.id && !check.data.trashed) {
            this.cachedSubscriptionDocsFolderId = cfg.subscriptionDocsFolderId;
            return cfg.subscriptionDocsFolderId;
          }
        } catch (err: any) {
          if (err?.code !== 404) {
            this.logger.warn(
              `Subscription docs folder verify failed: ${err.message}`,
            );
          }
          // Fall through and recreate
        }
      }

      const auth = await this.getAuthedClient();
      const folderId = await this.ensureFolderId(auth, 'ERP-Subscription-Docs');
      await this.backupConfigModel.findOneAndUpdate(
        {},
        { subscriptionDocsFolderId: folderId },
        { upsert: true },
      );
      this.cachedSubscriptionDocsFolderId = folderId;
      this.logger.log(`Subscription docs folder resolved: ${folderId}`);
      return folderId;
    })()
      .catch(async (err) => {
        await this.throwIfInvalidGrant(err);
        throw err;
      })
      .finally(() => {
        this.subscriptionDocsFolderPromise = null;
      });

    return this.subscriptionDocsFolderPromise;
  }

  async uploadToSubscriptionDocs(
    stream: Readable,
    filename: string,
    mimeType: string,
  ): Promise<UploadResult> {
    const folderId = await this.ensureSubscriptionDocsFolderId();
    const auth = await this.getAuthedClient();
    const drive = this.driveClient(auth);

    let uploadedBytes = 0;
    const progressStream = new PassThrough();
    progressStream.on('data', (chunk: Buffer) => {
      uploadedBytes += chunk.length;
    });
    stream.pipe(progressStream);
    stream.on('error', (err) => {
      this.logger.error(`Subscription doc upload stream error: ${err.message}`);
      progressStream.destroy(err);
    });

    try {
      const res = await drive.files.create({
        requestBody: { name: filename, parents: [folderId] },
        media: { mimeType, body: progressStream },
        fields: 'id,size',
      });
      const remoteKey = res.data.id;
      if (!remoteKey) {
        throw new InternalServerErrorException(
          'Drive upload returned no file id',
        );
      }
      const reportedSize = res.data.size
        ? Number(res.data.size)
        : uploadedBytes;
      this.logger.log(
        `Uploaded subscription doc ${filename} (${reportedSize} bytes) → ${remoteKey}`,
      );
      return { remoteKey, sizeBytes: reportedSize };
    } catch (err: any) {
      if (err instanceof PreconditionFailedException) throw err;
      await this.throwIfInvalidGrant(err);
      this.logger.error(`Subscription doc upload failed: ${err.message}`);
      throw new InternalServerErrorException(
        `Drive upload failed: ${err.message}`,
      );
    }
  }

  async downloadFromSubscriptionDocs(remoteKey: string): Promise<Readable> {
    const auth = await this.getAuthedClient();
    const drive = this.driveClient(auth);
    const res = await drive.files.get(
      { fileId: remoteKey, alt: 'media' },
      { responseType: 'stream' },
    );
    return res.data as unknown as Readable;
  }

  async deleteFromSubscriptionDocs(remoteKey: string): Promise<void> {
    const auth = await this.getAuthedClient();
    const drive = this.driveClient(auth);
    try {
      await drive.files.delete({ fileId: remoteKey });
    } catch (err: any) {
      if (err?.code === 404) return;
      throw err;
    }
  }

  async upload(
    stream: Readable,
    filename: string,
    mimeType: string,
  ): Promise<UploadResult> {
    const auth = await this.getAuthedClient();
    const folderId = await this.ensureBackupFolderId(auth);
    const drive = this.driveClient(auth);

    let uploadedBytes = 0;
    const progressStream = new PassThrough();
    progressStream.on('data', (chunk: Buffer) => {
      uploadedBytes += chunk.length;
    });
    stream.pipe(progressStream);
    stream.on('error', (err) => {
      this.logger.error(`Upload stream error: ${err.message}`);
      progressStream.destroy(err);
    });

    try {
      const res = await drive.files.create({
        requestBody: { name: filename, parents: [folderId] },
        media: { mimeType, body: progressStream },
        fields: 'id,size',
      });

      const remoteKey = res.data.id;
      if (!remoteKey) {
        throw new InternalServerErrorException(
          'Drive upload returned no file id',
        );
      }
      const reportedSize = res.data.size
        ? Number(res.data.size)
        : uploadedBytes;
      this.logger.log(
        `Uploaded ${filename} (${reportedSize} bytes) to Drive file ${remoteKey}`,
      );
      return { remoteKey, sizeBytes: reportedSize };
    } catch (err: any) {
      if (err instanceof PreconditionFailedException) throw err;
      await this.throwIfInvalidGrant(err);
      this.logger.error(`Google Drive upload failed: ${err.message}`);
      throw new InternalServerErrorException(
        `Drive upload failed: ${err.message}`,
      );
    }
  }

  async download(remoteKey: string): Promise<Readable> {
    const auth = await this.getAuthedClient();
    const drive = this.driveClient(auth);
    const res = await drive.files.get(
      { fileId: remoteKey, alt: 'media' },
      { responseType: 'stream' },
    );
    return res.data as unknown as Readable;
  }

  async delete(remoteKey: string): Promise<void> {
    const auth = await this.getAuthedClient();
    const drive = this.driveClient(auth);
    try {
      await drive.files.delete({ fileId: remoteKey });
    } catch (err: any) {
      if (err?.code === 404) return;
      throw err;
    }
  }

  async list(): Promise<StoredBackupInfo[]> {
    const cfg = await this.backupConfigModel.findOne().exec();
    if (!cfg || !cfg.driveFolderId) return [];
    const auth = await this.getAuthedClient();
    const drive = this.driveClient(auth);

    const items: StoredBackupInfo[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${cfg.driveFolderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id,name,size,createdTime)',
        pageSize: 100,
        pageToken,
      });
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name) continue;
        items.push({
          id: f.id,
          filename: f.name,
          sizeBytes: f.size ? Number(f.size) : 0,
          createdAt: f.createdTime ? new Date(f.createdTime) : new Date(0),
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return items;
  }
}
