import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RevenueService } from '../services/revenue.service';
import { PaginationQueryDto } from '../dto/query.dto';

@Controller('finance/revenue')
@UseGuards(AuthGuard('jwt'))
export class RevenueController {
  constructor(private readonly revenueService: RevenueService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.revenueService.findAll(query);
  }

  @Get('chart')
  getMonthlyChart(@Query('year') year?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.revenueService.getMonthlyChart(y);
  }
}
