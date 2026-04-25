import { Controller, Get, Delete, Query, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { RevenueService } from '../services/revenue.service';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

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

  @Delete(':id')
  @RequirePermissions('finance:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.revenueService.delete(id);
  }
}
