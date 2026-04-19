import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContractTypesService } from './contract-types.service';
import { CreateContractTypeDto, UpdateContractTypeDto } from './dto/contract-type.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Contract Types')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('contract-types')
export class ContractTypesController {
  constructor(private readonly contractTypesService: ContractTypesService) {}

  @Post()
  @RequirePermissions('contract-types:create')
  @ApiOperation({ summary: 'Create contract type' })
  create(@Body() dto: CreateContractTypeDto) {
    return this.contractTypesService.create(dto);
  }

  @Get()
  @RequirePermissions('contract-types:read')
  @ApiOperation({ summary: 'Get all contract types' })
  findAll() {
    return this.contractTypesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('contract-types:read')
  @ApiOperation({ summary: 'Get contract type by ID' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.contractTypesService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('contract-types:update')
  @ApiOperation({ summary: 'Update contract type' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateContractTypeDto) {
    return this.contractTypesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('contract-types:delete')
  @ApiOperation({ summary: 'Delete contract type' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.contractTypesService.remove(id);
  }
}
