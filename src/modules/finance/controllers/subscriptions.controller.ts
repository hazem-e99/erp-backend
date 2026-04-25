import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { SubscriptionsService } from '../services/subscriptions.service';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

@Controller('finance/subscriptions')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @RequirePermissions('finance:create')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.subscriptionsService.findAll(query);
  }

  @Get('metrics')
  @RequirePermissions('finance:read')
  getMetrics() {
    return this.subscriptionsService.getDashboardMetrics();
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('finance:update')
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.subscriptionsService.cancel(id, reason);
  }

  @Delete(':id')
  @RequirePermissions('finance:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptionsService.delete(id);
  }
}
