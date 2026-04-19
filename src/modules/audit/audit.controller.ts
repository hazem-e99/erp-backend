import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Get all audit logs with filters and pagination' })
  async findAll(@Query() query: QueryAuditLogDto) {
    return this.auditService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Get audit log statistics' })
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.auditService.getStats(start, end);
  }

  @Get('user/:userId')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Get recent activity for a specific user' })
  async getUserActivity(
    @Param('userId', ParseObjectIdPipe) userId: string,
    @Query('limit') limit?: number,
  ) {
    return this.auditService.getUserActivity(userId, limit);
  }

  @Get(':id')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Get audit log by ID' })
  async findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.auditService.findById(id);
  }
}
