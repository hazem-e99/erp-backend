import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { RevenueService } from '../services/revenue.service';
import { PaginationQueryDto } from '../dto/query.dto';

@Controller('finance/revenue')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class RevenueController {
  constructor(private readonly revenueService: RevenueService) {}

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.revenueService.findAll(query);
  }

  @Get('chart')
  @RequirePermissions('finance:read')
  getMonthlyChart(@Query('year') year?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.revenueService.getMonthlyChart(y);
  }
}
