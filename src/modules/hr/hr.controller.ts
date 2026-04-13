import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import * as express from 'express';
import { HrService } from './hr.service';
import { ExportService } from './export.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@ApiTags('HR Module')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('hr')
export class HrController {
  constructor(
    private hrService: HrService,
    private exportService: ExportService,
  ) {}

  // ─── Dashboard ───

  @Get('dashboard')
  @RequirePermissions('hr:dashboard')
  @ApiOperation({ summary: 'HR Dashboard stats' })
  getDashboardStats() {
    return this.hrService.getDashboardStats();
  }

  // ─── Attendance ───

  @Get('attendance')
  @RequirePermissions('hr:attendance')
  @ApiOperation({ summary: 'Attendance overview for all employees' })
  getAttendanceOverview(@Query() query: any) {
    return this.hrService.getAttendanceOverview(query);
  }

  @Get('attendance/trend')
  @RequirePermissions('hr:reports')
  @ApiOperation({ summary: 'Attendance trend (for charts)' })
  getAttendanceTrend(@Query() query: any) {
    return this.hrService.getAttendanceTrend(query);
  }

  // ─── Analytics ───

  @Get('analytics')
  @RequirePermissions('hr:reports')
  @ApiOperation({ summary: 'HR Analytics (daily/monthly/yearly)' })
  getAnalytics(@Query() query: any) {
    return this.hrService.getAnalytics(query);
  }

  // ─── Leave Stats ───

  @Get('leave-stats')
  @RequirePermissions('hr:leaves')
  @ApiOperation({ summary: 'Leave requests status distribution' })
  getLeaveStats(@Query() query: any) {
    return this.hrService.getLeaveStats(query);
  }

  // ─── Export Endpoints ───

  @Get('export/employees')
  @RequirePermissions('export:data')
  @ApiOperation({ summary: 'Export employees to Excel' })
  async exportEmployees(@Query() query: any, @Res() res: express.Response) {
    const buffer = await this.exportService.exportEmployees(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=employees_${Date.now()}.xlsx`);
    res.send(buffer);
  }

  @Get('export/attendance')
  @RequirePermissions('export:data')
  @ApiOperation({ summary: 'Export attendance to Excel' })
  async exportAttendance(@Query() query: any, @Res() res: express.Response) {
    const buffer = await this.exportService.exportAttendance(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${Date.now()}.xlsx`);
    res.send(buffer);
  }

  @Get('export/leaves')
  @RequirePermissions('export:data')
  @ApiOperation({ summary: 'Export leaves to Excel' })
  async exportLeaves(@Query() query: any, @Res() res: express.Response) {
    const buffer = await this.exportService.exportLeaves(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=leaves_${Date.now()}.xlsx`);
    res.send(buffer);
  }

  @Get('export/projects')
  @RequirePermissions('export:data')
  @ApiOperation({ summary: 'Export projects to Excel' })
  async exportProjects(@Query() query: any, @Res() res: express.Response) {
    const buffer = await this.exportService.exportProjects(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=projects_${Date.now()}.xlsx`);
    res.send(buffer);
  }

  @Get('export/tasks')
  @RequirePermissions('export:data')
  @ApiOperation({ summary: 'Export tasks to Excel' })
  async exportTasks(@Query() query: any, @Res() res: express.Response) {
    const buffer = await this.exportService.exportTasks(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=tasks_${Date.now()}.xlsx`);
    res.send(buffer);
  }
}
