import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { GeneratePayrollDto, UpdatePayrollDto } from './dto/payroll.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('payroll')
export class PayrollController {
  constructor(private payrollService: PayrollService) {}

  @Post('generate')
  @RequirePermissions('payroll:create')
  @ApiOperation({ summary: 'Generate payroll for employee' })
  generate(@Body() dto: GeneratePayrollDto) {
    return this.payrollService.generate(dto);
  }

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Get all payrolls' })
  findAll(@Query() query: any) {
    return this.payrollService.findAll(query);
  }

  // IMPORTANT: `/me` must come BEFORE `/:id` to avoid route collision
  @Get('me')
  @ApiOperation({ summary: 'Get my payroll records' })
  getMyPayroll(@CurrentUser('_id') userId: string) {
    return this.payrollService.getMyPayroll(userId);
  }

  @Get(':id')
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Get payroll by ID' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.payrollService.findById(id);
  }

  @Get(':id/payslip')
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Get payslip' })
  getPayslip(@Param('id', ParseObjectIdPipe) id: string) {
    return this.payrollService.getPayslip(id);
  }

  @Put(':id')
  @RequirePermissions('payroll:update')
  @ApiOperation({ summary: 'Update payroll' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePayrollDto) {
    return this.payrollService.update(id, dto);
  }
}
