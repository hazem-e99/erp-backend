import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Clients')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('clients')
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  @RequirePermissions('clients:read')
  @ApiOperation({ summary: 'Get all clients' })
  findAll(@Query() query: any) {
    return this.clientsService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('clients:read')
  @ApiOperation({ summary: 'Get client stats' })
  getStats() {
    return this.clientsService.getStats();
  }

  @Get(':id')
  @RequirePermissions('clients:read')
  @ApiOperation({ summary: 'Get client by ID' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.clientsService.findById(id);
  }

  @Post()
  @RequirePermissions('clients:create')
  @ApiOperation({ summary: 'Create client' })
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Put(':id')
  @RequirePermissions('clients:update')
  @ApiOperation({ summary: 'Update client' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('clients:delete')
  @ApiOperation({ summary: 'Delete client' })
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.clientsService.delete(id);
  }
}
