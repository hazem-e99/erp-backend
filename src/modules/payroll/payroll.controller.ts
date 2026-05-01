import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
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

  // IMPORTANT: static routes must come BEFORE `/:id` to avoid ParseObjectIdPipe collisions
  @Get('pending-expenses-amount')
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Get total amount of paid payrolls not recorded as expenses' })
  async getPendingExpensesAmount() {
    const total = await this.payrollService.getPendingExpensesAmount();
    return { total };
  }

  @Post('mark-as-expenses')
  @RequirePermissions('payroll:create')
  @ApiOperation({ summary: 'Mark all paid payrolls as expenses' })
  markAsExpenses(@Body() body: { month?: number; year?: number; expenseDate?: string }) {
    return this.payrollService.markAsExpenses(body.month, body.year, body.expenseDate);
  }

  @Post('mark-as-expense-employee')
  @RequirePermissions('payroll:create')
  @ApiOperation({ summary: 'Mark paid payrolls for a single employee as expenses' })
  markEmployeeAsExpense(@Body() body: { employeeId: string; month?: number; year?: number; expenseDate?: string }) {
    return this.payrollService.markAsExpenseForEmployee(body.employeeId, body.month, body.year, body.expenseDate);
  }

  @Post('update-expense')
  @RequirePermissions('payroll:update')
  @ApiOperation({ summary: 'Update the salary expense record for a given month' })
  updateExpense(@Body() body: { month: number; year: number }) {
    return this.payrollService.updateExpense(body.month, body.year);
  }

  @Post('unlink-expense')
  @RequirePermissions('payroll:update')
  @ApiOperation({ summary: 'Unlink and delete the salary expense for a given month so it can be re-recorded' })
  unlinkExpense(@Body() body: { month: number; year: number }) {
    return this.payrollService.unlinkExpense(body.month, body.year);
  }

  @Post('clean-old-expenses')
  @RequirePermissions('payroll:update')
  @ApiOperation({ summary: 'Delete all old/duplicate salary expenses from Finance' })
  cleanOldExpenses() {
    return this.payrollService.cleanOldExpenses();
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

  @Post(':id/upload-screenshot')
  @RequirePermissions('payroll:update')
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'payroll'),
        filename: (req, file, cb) => {
          const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new Error('Only image files allowed'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  @ApiOperation({ summary: 'Upload transfer screenshot' })
  async uploadScreenshot(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('transactionNumber') transactionNumber?: string,
  ) {
    const screenshotPath = file ? `/uploads/payroll/${file.filename}` : undefined;
    return this.payrollService.update(id, {
      transferScreenshot: screenshotPath,
      transactionNumber: transactionNumber || undefined,
      status: 'paid',
    });
  }
}
