import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditEntity } from '../../modules/audit/schemas/audit-log.schema';

export const AUDIT_LOG_KEY = 'audit_log';

export interface AuditLogMetadata {
  action: AuditAction;
  entity: AuditEntity;
  description?: string;
}

/**
 * Decorator to automatically log actions
 * 
 * Usage:
 * @AuditLog({ action: AuditAction.CREATE, entity: AuditEntity.EMPLOYEE })
 * async createEmployee(@Body() dto: CreateEmployeeDto, @GetUser() user: User) {
 *   // Your code here
 * }
 */
export const AuditLog = (metadata: AuditLogMetadata) =>
  SetMetadata(AUDIT_LOG_KEY, metadata);
