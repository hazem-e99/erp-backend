import {
  Controller, Get, Post, Body, Query, UseGuards,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { PaymentsService } from '../services/payments.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaginationQueryDto } from '../dto/query.dto';

@Controller('finance/payments')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequirePermissions('finance:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreatePaymentDto) {
    const { payment, overflow } = await this.paymentsService.create(dto);
    return { payment, overflow };
  }

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.paymentsService.findAll(query);
  }
}
