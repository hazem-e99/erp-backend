import { IsEnum, IsOptional, IsString, IsDateString, IsMongoId } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AuditEntity, AuditStatus } from '../schemas/audit-log.schema';

export class CreateAuditLogDto {
  @IsMongoId()
  userId!: string;

  @IsString()
  userEmail!: string;

  @IsString()
  userName!: string;

  @IsEnum(AuditAction)
  action!: AuditAction;

  @IsEnum(AuditEntity)
  entity!: AuditEntity;

  @IsOptional()
  @IsMongoId()
  entityId?: string;

  @IsOptional()
  oldData?: Record<string, any>;

  @IsOptional()
  newData?: Record<string, any>;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(AuditStatus)
  status?: AuditStatus;

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryAuditLogDto {
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditEntity)
  entity?: AuditEntity;

  @IsOptional()
  @IsMongoId()
  entityId?: string;

  @IsOptional()
  @IsEnum(AuditStatus)
  status?: AuditStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  search?: string;
}
