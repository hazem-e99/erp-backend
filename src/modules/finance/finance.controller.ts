import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Get all transactions' })
  findAll(@Query() query: any) {
    return this.financeService.findAll(query);
  }

  @Get('summary')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Get financial summary' })
  getSummary(@Query() query: any) {
    return this.financeService.getSummary(query);
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Get transaction by ID' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.financeService.findById(id);
  }

  @Post()
  @RequirePermissions('finance:create')
  @ApiOperation({ summary: 'Create transaction' })
  create(@Body() dto: CreateTransactionDto, @CurrentUser('_id') userId: string) {
    return this.financeService.create(dto, userId);
  }

  @Put(':id')
  @RequirePermissions('finance:update')
  @ApiOperation({ summary: 'Update transaction' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateTransactionDto) {
    return this.financeService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('finance:delete')
  @ApiOperation({ summary: 'Delete transaction' })
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.financeService.delete(id);
  }
}
