import {
  Controller, Get, Post, Body, Query, UseGuards,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PaymentsService } from '../services/payments.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaginationQueryDto } from '../dto/query.dto';

@Controller('finance/payments')
@UseGuards(AuthGuard('jwt'))
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreatePaymentDto) {
    const { payment, overflow } = await this.paymentsService.create(dto);
    return { payment, overflow };
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.paymentsService.findAll(query);
  }
}
