import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { JsonExportService } from './json-export.service';
import { BackupScheduler, BackupTriggerController } from './backup.scheduler';
import { GoogleOAuthController } from './google-oauth.controller';
import { GoogleDriveStorage } from './storage/google-drive.storage';
import { LocalStorage } from './storage/local.storage';
import { TokenCryptoService } from './token-crypto.service';
import { MaintenanceLockService } from './maintenance-lock.service';
import { BACKUP_STORAGE } from './storage/storage.interface';
import {
  BackupRecord,
  BackupRecordSchema,
} from './schemas/backup-record.schema';
import {
  BackupConfig,
  BackupConfigSchema,
} from './schemas/backup-config.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Role, RoleSchema } from '../roles/schemas/role.schema';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    ConfigModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret-key-change-me'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    MongooseModule.forFeature([
      { name: BackupRecord.name, schema: BackupRecordSchema },
      { name: BackupConfig.name, schema: BackupConfigSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  controllers: [BackupController, GoogleOAuthController, BackupTriggerController],
  providers: [
    BackupService,
    JsonExportService,
    BackupScheduler,
    GoogleDriveStorage,
    LocalStorage,
    TokenCryptoService,
    MaintenanceLockService,
    {
      provide: BACKUP_STORAGE,
      inject: [ConfigService, GoogleDriveStorage, LocalStorage],
      useFactory: (
        config: ConfigService,
        drive: GoogleDriveStorage,
        local: LocalStorage,
      ) => {
        const driver = config.get<string>('BACKUP_STORAGE_DRIVER', 'google-drive');
        return driver === 'local' ? local : drive;
      },
    },
  ],
  exports: [BackupService, MaintenanceLockService, GoogleDriveStorage],
})
export class BackupModule {}
