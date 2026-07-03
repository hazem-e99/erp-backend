import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import {
  GeneratePayrollDto,
  UpdatePayrollDto,
  UpsertPayrollConfigDto,
} from './dto/payroll.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';
import { DriveAttachmentsService } from '../backup/drive-attachments.service';

@ApiTags('Payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('payroll')
export class PayrollController {
  constructor(
    private payrollService: PayrollService,
    private readonly attachments: DriveAttachmentsService,
  ) {}

  // ── Payroll Config ──────────────────────────────────────────────────────────

  @Get('config')
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Get payroll cycle configuration' })
  getConfig() {
    return this.payrollService.getConfig();
  }

  @Put('config')
  @RequirePermissions('payroll:create')
  @ApiOperation({ summary: 'Update payroll cycle configuration' })
  upsertConfig(@Body() dto: UpsertPayrollConfigDto) {
    return this.payrollService.upsertConfig(dto);
  }

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

  // IMPORTANT: static routes must come BEFORE `/:id` to avoid ParseObjectIdPipe collisions
  @Get('pending-expenses-amount')
  @RequirePermissions('payroll:read')
  @ApiOperation({
    summary: 'Get total amount of paid payrolls not recorded as expenses',
  })
  async getPendingExpensesAmount() {
    const total = await this.payrollService.getPendingExpensesAmount();
    return { total };
  }

  @Post('mark-as-expenses')
  @RequirePermissions('payroll:create')
  @ApiOperation({ summary: 'Mark all paid payrolls as expenses' })
  markAsExpenses(
    @Body() body: { month?: number; year?: number; expenseDate?: string },
  ) {
    return this.payrollService.markAsExpenses(
      body.month,
      body.year,
      body.expenseDate,
    );
  }

  @Post('mark-as-expense-employee')
  @RequirePermissions('payroll:create')
  @ApiOperation({
    summary: 'Mark paid payrolls for a single employee as expenses',
  })
  markEmployeeAsExpense(
    @Body()
    body: {
      employeeId: string;
      month?: number;
      year?: number;
      expenseDate?: string;
    },
  ) {
    return this.payrollService.markAsExpenseForEmployee(
      body.employeeId,
      body.month,
      body.year,
      body.expenseDate,
    );
  }

  @Post('update-expense')
  @RequirePermissions('payroll:update')
  @ApiOperation({
    summary: 'Update the salary expense record for a given month',
  })
  updateExpense(@Body() body: { month: number; year: number }) {
    return this.payrollService.updateExpense(body.month, body.year);
  }

  @Post('unlink-expense')
  @RequirePermissions('payroll:update')
  @ApiOperation({
    summary:
      'Unlink and delete the salary expense for a given month so it can be re-recorded',
  })
  unlinkExpense(@Body() body: { month: number; year: number }) {
    return this.payrollService.unlinkExpense(body.month, body.year);
  }

  @Get('recorded-expense-total')
  @RequirePermissions('payroll:read')
  @ApiOperation({
    summary:
      'Sum the salary expense documents that landed inside a payroll month — the value Finance actually shows',
  })
  getRecordedExpenseTotalForMonth(
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.payrollService.getRecordedExpenseTotalForMonth(
      Number(month),
      Number(year),
    );
  }

  @Get('reconciliation-status')
  @RequirePermissions('payroll:read')
  @ApiOperation({
    summary:
      'Compare salary expenses against their linked payrolls and report drift',
  })
  getReconciliationStatus(
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.payrollService.getReconciliationStatus(
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );
  }

  @Get('debug-expense/:expenseId')
  @RequirePermissions('payroll:read')
  @ApiOperation({
    summary:
      'Deep debug dump for a salary expense — returns linked payrolls and per-row diffs',
  })
  debugExpenseBreakdown(
    @Param('expenseId', ParseObjectIdPipe) expenseId: string,
  ) {
    return this.payrollService.debugExpenseBreakdown(expenseId);
  }

  @Post('reconcile-expenses')
  @RequirePermissions('payroll:update')
  @ApiOperation({
    summary:
      'Force-resync every salary expense from its linked payrolls and clean orphan references',
  })
  reconcileAllExpenses() {
    return this.payrollService.reconcileAllExpenses();
  }

  @Post('clean-old-expenses')
  @RequirePermissions('payroll:update')
  @ApiOperation({
    summary:
      'Delete salary expenses from Finance. Pass month+year to scope the cleanup; omit both to clean every month.',
  })
  cleanOldExpenses(@Body() body: { month?: number; year?: number } = {}) {
    return this.payrollService.cleanOldExpenses(body.month, body.year);
  }

  @Get('expense/:expenseId/details')
  @RequirePermissions('payroll:read')
  @ApiOperation({
    summary:
      'Get the payroll breakdown (per-employee bonuses, deductions, KPI, net, receipt) for a salary expense',
  })
  getExpensePayrollDetails(
    @Param('expenseId', ParseObjectIdPipe) expenseId: string,
  ) {
    return this.payrollService.getExpensePayrollDetails(expenseId);
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
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePayrollDto,
  ) {
    return this.payrollService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('payroll:update')
  @ApiOperation({
    summary:
      'Delete a payroll record. If linked to a Finance expense, pass force=true to detach and re-sync the expense.',
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('force') force?: string,
  ) {
    return this.payrollService.remove(id, force === 'true' || force === '1');
  }

  @Post(':id/upload-screenshot')
  @RequirePermissions('payroll:update')
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: memoryStorage(),
      // Accept any file type — restriction caused legitimate uploads to be rejected
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    }),
  )
  @ApiOperation({ summary: 'Upload transfer screenshot' })
  async uploadScreenshot(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('transactionNumber') transactionNumber?: string,
  ) {
    const screenshotPath = file
      ? await this.attachments.upload(file, 'payroll')
      : undefined;
    return this.payrollService.update(id, {
      transferScreenshot: screenshotPath,
      transactionNumber: transactionNumber || undefined,
      status: 'paid',
    });
  }
}
