import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InstallmentsService } from '../services/installments.service';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

@Controller('finance/installments')
@UseGuards(AuthGuard('jwt'))
export class InstallmentsController {
  constructor(private readonly installmentsService: InstallmentsService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.installmentsService.findAll(query);
  }

  @Get('outstanding')
  getOutstandingTotal() {
    return this.installmentsService.getOutstandingTotal().then((total) => ({ total }));
  }

  @Get('overdue-count')
  getOverdueCount() {
    return this.installmentsService.getOverdueCount().then((count) => ({ count }));
  }

  @Get('by-subscription/:subscriptionId')
  findBySubscription(@Param('subscriptionId', ParseObjectIdPipe) subscriptionId: string) {
    return this.installmentsService.findBySubscription(subscriptionId);
  }
}
