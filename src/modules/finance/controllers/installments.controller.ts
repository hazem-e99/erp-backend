import { Controller, Get, Delete, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { InstallmentsService } from '../services/installments.service';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

@Controller('finance/installments')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class InstallmentsController {
  constructor(private readonly installmentsService: InstallmentsService) {}

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.installmentsService.findAll(query);
  }

  @Get('outstanding')
  @RequirePermissions('finance:read')
  getOutstandingTotal() {
    return this.installmentsService.getOutstandingTotal().then((total) => ({ total }));
  }

  @Get('overdue-count')
  @RequirePermissions('finance:read')
  getOverdueCount() {
    return this.installmentsService.getOverdueCount().then((count) => ({ count }));
  }

  @Get('by-subscription/:subscriptionId')
  @RequirePermissions('finance:read')
  findBySubscription(@Param('subscriptionId', ParseObjectIdPipe) subscriptionId: string) {
    return this.installmentsService.findBySubscription(subscriptionId);
  }

  @Delete(':id')
  @RequirePermissions('finance:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.installmentsService.delete(id);
  }
}
