import { Controller, Get, Query, UseGuards, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService } from '../services/reports.service';
import { ReportQueryDto } from '../dto/query.dto';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';

@Controller('finance/reports')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  getDashboard() {
    return this.reportsService.getDashboardSummary();
  }

  @Get('cash-flow')
  getCashFlow(@Query() query: ReportQueryDto) {
    return this.reportsService.getCashFlow(query);
  }

  @Get('profit-loss')
  getProfitLoss(@Query() query: ReportQueryDto) {
    return this.reportsService.getProfitLoss(query);
  }

  @Get('outstanding-payments')
  getOutstandingPayments() {
    return this.reportsService.getOutstandingPayments();
  }

  @Get('subscription-metrics')
  getSubscriptionMetrics() {
    return this.reportsService.getSubscriptionMetrics();
  }

  @Delete('clear-all-data')
  @Permissions('finance:delete-all')
  @HttpCode(HttpStatus.OK)
  deleteAllFinanceData() {
    return this.reportsService.deleteAllFinanceData();
  }
}
