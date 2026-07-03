import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import {
  AUDIT_LOG_KEY,
  AuditLogMetadata,
} from '../../common/decorators/audit-log.decorator';
import { AuditService } from './audit.service';
import { AuditAction, AuditEntity } from './schemas/audit-log.schema';

type RequestWithUser = Request & {
  user?: Record<string, any>;
  file?: Express.Multer.File;
  files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
};

const SENSITIVE_KEY =
  /password|passcode|token|authorization|cookie|secret|api[-_]?key|otp|pin|credential/i;
const OBJECT_ID = /^[a-f\d]{24}$/i;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.method === 'OPTIONS') return next.handle();

    const response = context.switchToHttp().getResponse();
    const startedAt = Date.now();
    const override = this.reflector.getAllAndOverride<AuditLogMetadata>(
      AUDIT_LOG_KEY,
      [context.getHandler(), context.getClass()],
    );
    const action = override?.action ?? this.inferAction(request);
    const entity = override?.entity ?? this.inferEntity(request);

    return next.handle().pipe(
      tap({
        next: (result) => {
          void this.writeLog({
            request,
            action,
            entity,
            result,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
            description: override?.description,
          });
        },
        error: (error) => {
          void this.writeLog({
            request,
            action,
            entity,
            error,
            statusCode: error?.status ?? response.statusCode ?? 500,
            durationMs: Date.now() - startedAt,
            description: override?.description,
          });
        },
      }),
    );
  }

  private async writeLog(input: {
    request: RequestWithUser;
    action: AuditAction;
    entity: AuditEntity;
    result?: any;
    error?: any;
    statusCode: number;
    durationMs: number;
    description?: string;
  }): Promise<void> {
    try {
      const { request, result, error } = input;
      const responseUser = result?.user;
      const actor = request.user ?? responseUser ?? {};
      const userId = this.asId(actor.userId ?? actor._id ?? actor.id);
      const userEmail =
        actor.email ?? request.body?.email ?? 'anonymous@system.local';
      const userName = actor.name ?? (userId ? userEmail : 'Anonymous');
      const entityId = this.findEntityId(request, result);
      const body = this.sanitize(request.body);
      const newData =
        body && typeof body === 'object' && Object.keys(body).length
          ? body
          : undefined;
      const metadata = {
        method: request.method,
        path: request.originalUrl?.split('?')[0] ?? request.url,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        params: this.sanitize(request.params),
        query: this.sanitize(request.query),
        files: this.fileMetadata(request),
        response: this.responseMetadata(result, input.action),
      };
      const base = {
        userId,
        userEmail: String(userEmail),
        userName: String(userName),
        action: input.action,
        entity: input.entity,
        entityId,
        description:
          input.description ??
          `${input.action} ${input.entity} via ${request.method} ${metadata.path}`,
        newData,
        ipAddress: this.ipAddress(request),
        userAgent: request.get('user-agent'),
        metadata,
      };

      if (error) {
        await this.auditService.logFailure({
          ...base,
          errorMessage: String(error?.message ?? 'Unknown error'),
        });
      } else {
        await this.auditService.logAction(base);
      }
    } catch (error: any) {
      // Audit logging must never break the business request.
      this.logger.error(`Could not save audit log: ${error?.message ?? error}`);
    }
  }

  private inferAction(request: RequestWithUser): AuditAction {
    const path = request.originalUrl.toLowerCase().split('?')[0];
    if (path.endsWith('/auth/login')) return AuditAction.LOGIN;
    if (path.includes('logout')) return AuditAction.LOGOUT;
    if (path.includes('approve')) return AuditAction.APPROVE;
    if (path.includes('reject')) return AuditAction.REJECT;
    if (path.includes('download')) return AuditAction.DOWNLOAD;
    if (path.includes('export')) return AuditAction.EXPORT;
    if (path.includes('import')) return AuditAction.IMPORT;
    if (path.includes('upload')) return AuditAction.UPLOAD;
    if (path.includes('generate')) return AuditAction.GENERATE;
    if (path.includes('send') || path.includes('test-email'))
      return AuditAction.SEND;
    if (
      /\/(cancel|terminate|reset-password|assign|disconnect|reconcile|normalize|mark-as-|unlink-|read-all|read)(\/|$)/.test(
        path,
      )
    )
      return AuditAction.UPDATE;

    switch (request.method) {
      case 'GET':
        return AuditAction.READ;
      case 'POST':
        return AuditAction.CREATE;
      case 'PUT':
      case 'PATCH':
        return AuditAction.UPDATE;
      case 'DELETE':
        return AuditAction.DELETE;
      default:
        return AuditAction.OTHER;
    }
  }

  private inferEntity(request: RequestWithUser): AuditEntity {
    const segments = request.originalUrl
      .split('?')[0]
      .split('/')
      .filter(Boolean)
      .filter((part) => part !== 'api' && part !== 'finance');
    const path = segments.join('/').toLowerCase();
    const mappings: Array<[RegExp, AuditEntity]> = [
      [/contract-types?/, AuditEntity.CONTRACT_TYPE],
      [/notifications?/, AuditEntity.NOTIFICATION],
      [/commissions?/, AuditEntity.COMMISSION],
      [/installments?/, AuditEntity.INSTALLMENT],
      [/subscriptions?/, AuditEntity.SUBSCRIPTION],
      [/departments?/, AuditEntity.DEPARTMENT],
      [/positions?/, AuditEntity.POSITION],
      [/announcements?/, AuditEntity.ANNOUNCEMENT],
      [/attendance/, AuditEntity.ATTENDANCE],
      [/employees?/, AuditEntity.EMPLOYEE],
      [/clients?/, AuditEntity.CLIENT],
      [/projects?/, AuditEntity.PROJECT],
      [/tasks?/, AuditEntity.TASK],
      [/leaves?/, AuditEntity.LEAVE],
      [/payroll/, AuditEntity.PAYROLL],
      [/payments?/, AuditEntity.PAYMENT],
      [/expenses?/, AuditEntity.EXPENSE],
      [/revenue/, AuditEntity.REVENUE],
      [/reminders?/, AuditEntity.REMINDER],
      [/roles?/, AuditEntity.ROLE],
      [/users?|auth/, AuditEntity.USER],
      [/backup/, AuditEntity.BACKUP],
      [/reports?|dashboard|analytics/, AuditEntity.REPORT],
      [/settings|config/, AuditEntity.SETTINGS],
      [/documents?/, AuditEntity.DOCUMENT],
    ];
    return (
      mappings.find(([pattern]) => pattern.test(path))?.[1] ??
      AuditEntity.SYSTEM
    );
  }

  private sanitize(value: any, depth = 0): any {
    if (value == null) return value;
    if (depth > 5) return '[max-depth]';
    if (Buffer.isBuffer(value)) return `[buffer:${value.length} bytes]`;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string')
      return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value))
      return value.slice(0, 100).map((item) => this.sanitize(item, depth + 1));

    const source =
      typeof value.toObject === 'function' ? value.toObject() : value;
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(source).slice(0, 100)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : this.sanitize(item, depth + 1);
    }
    return output;
  }

  private findEntityId(
    request: RequestWithUser,
    result: any,
  ): string | undefined {
    const candidate =
      request.params?.id ?? result?._id ?? result?.id ?? result?.data?._id;
    return this.asId(candidate);
  }

  private responseMetadata(result: any, action: AuditAction): any {
    if (result == null) return result;
    if (Buffer.isBuffer(result))
      return { type: 'buffer', bytes: result.length };
    if (Array.isArray(result)) return { type: 'array', count: result.length };

    if (typeof result === 'object' && Array.isArray(result.data)) {
      return {
        type: 'paginated',
        count: result.data.length,
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
      };
    }

    // Read/export responses can contain whole collections (including audit logs).
    // Store proof of the operation without duplicating the returned dataset.
    if (
      action === AuditAction.READ ||
      action === AuditAction.EXPORT ||
      action === AuditAction.DOWNLOAD
    ) {
      return {
        type: result?.constructor?.name ?? typeof result,
        entityId: this.asId(result?._id ?? result?.id),
      };
    }

    return this.sanitize(result);
  }

  private asId(value: any): string | undefined {
    const id = value?.toString?.();
    return id && OBJECT_ID.test(id) ? id : undefined;
  }

  private ipAddress(request: RequestWithUser): string | undefined {
    const forwarded = request.headers['x-forwarded-for'];
    if (Array.isArray(forwarded)) return forwarded[0];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return request.ip ?? request.socket?.remoteAddress;
  }

  private fileMetadata(request: RequestWithUser): any[] | undefined {
    const files: Express.Multer.File[] = [];
    if (request.file) files.push(request.file);
    if (Array.isArray(request.files)) files.push(...request.files);
    else if (request.files)
      Object.values(request.files).forEach((group) => files.push(...group));
    if (!files.length) return undefined;
    return files.map(({ fieldname, originalname, mimetype, size }) => ({
      fieldname,
      originalname,
      mimetype,
      size,
    }));
  }
}
