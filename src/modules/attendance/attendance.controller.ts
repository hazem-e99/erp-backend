import { Controller, Get, Post, Put, Body, Query, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { CheckInDto, CheckOutDto } from './dto/attendance.dto';
import { UpdateAttendanceSettingsDto } from './dto/attendance-settings.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  // ─── Attendance Settings (requires attendance:settings permission) ────────────

  @Get('settings')
  @ApiOperation({ summary: 'Get current work schedule settings' })
  getSettings() {
    return this.attendanceService.getSettings();
  }

  @Put('settings')
  @RequirePermissions('attendance:settings')
  @ApiOperation({ summary: 'Update work schedule settings (admin/HR only)' })
  updateSettings(@Body() dto: UpdateAttendanceSettingsDto) {
    return this.attendanceService.updateSettings(dto);
  }

  // ─── Employee Actions ─────────────────────────────────────────────────────────

  @Post('check-in')
  @ApiOperation({ summary: 'Check in for today' })
  checkIn(@CurrentUser('_id') userId: string, @Body() dto: CheckInDto) {
    return this.attendanceService.checkIn(userId, dto);
  }

  @Post('check-out')
  @ApiOperation({ summary: 'Check out for today' })
  checkOut(@CurrentUser('_id') userId: string, @Body() dto: CheckOutDto) {
    return this.attendanceService.checkOut(userId, dto);
  }

  @Get('today')
  @ApiOperation({ summary: 'Get today attendance status + current settings' })
  getTodayStatus(@CurrentUser('_id') userId: string) {
    return this.attendanceService.getTodayStatus(userId);
  }

  // `/me` must come before any parameterized routes
  @Get('me')
  @ApiOperation({ summary: 'Get my attendance records' })
  getMyAttendance(@CurrentUser('_id') userId: string, @Query() query: any) {
    return this.attendanceService.getMyAttendance(userId, query);
  }

  // ─── HR / Admin Queries ───────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: 'Get all attendance records' })
  findAll(@Query() query: any) {
    return this.attendanceService.findAll(query);
  }

  @Get('report/:employeeId')
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: 'Get monthly attendance report for employee' })
  getMonthlyReport(
    @Param('employeeId', ParseObjectIdPipe) employeeId: string,
    @Query('month') month: number,
    @Query('year') year: number,
  ) {
    return this.attendanceService.getMonthlyReport(employeeId, +month, +year);
  }
}
