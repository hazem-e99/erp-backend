import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto, UpdateProfileDto, ChangePasswordDto, AdminResetPasswordDto } from './dto/employee.dto';
import { CreateEmployeeSettlementDto } from './dto/settlement.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my employee profile' })
  getMyProfile(@CurrentUser('_id') userId: string) {
    return this.employeesService.findByUserId(userId);
  }

  @Put('me/profile')
  @ApiOperation({ summary: 'Update own profile (limited fields)' })
  updateOwnProfile(@CurrentUser('_id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.employeesService.updateOwnProfile(userId, dto);
  }

  @Post('me/change-password')
  @ApiOperation({ summary: 'Change own password' })
  changePassword(@CurrentUser('_id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.employeesService.changePassword(userId, dto);
  }

  @Get()
  @RequirePermissions('employees:read')
  @ApiOperation({ summary: 'Get all employees' })
  findAll(@Query() query: any) {
    return this.employeesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('employees:read')
  @ApiOperation({ summary: 'Get employee by ID' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.employeesService.findById(id);
  }

  @Post()
  @RequirePermissions('employees:create')
  @ApiOperation({ summary: 'Create employee + user account' })
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Put(':id')
  @RequirePermissions('employees:update')
  @ApiOperation({ summary: 'Update employee (admin)' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(id, dto);
  }

  @Post(':id/reset-password')
  @RequirePermissions('employees:update')
  @ApiOperation({ summary: 'Admin reset employee password' })
  resetPassword(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: AdminResetPasswordDto) {
    return this.employeesService.adminResetPassword(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employees:delete')
  @ApiOperation({ summary: 'Soft-delete (terminate) employee' })
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.employeesService.delete(id);
  }

  @Post(':id/terminate')
  @RequirePermissions('employees:delete')
  @ApiOperation({ summary: 'Terminate employee + record final settlement' })
  terminateWithSettlement(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateEmployeeSettlementDto,
  ) {
    return this.employeesService.terminateWithSettlement(id, dto);
  }

  @Delete(':id/permanent')
  @RequirePermissions('employees:delete')
  @ApiOperation({ summary: 'Permanently delete employee and linked user account' })
  deletePermanently(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('_id') currentUserId: string,
  ) {
    return this.employeesService.deletePermanently(id, currentUserId);
  }
}
