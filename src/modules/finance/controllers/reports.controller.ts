import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService } from '../services/reports.service';
import { ReportQueryDto } from '../dto/query.dto';

@Controller('finance/reports')
@UseGuards(AuthGuard('jwt'))
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
}
