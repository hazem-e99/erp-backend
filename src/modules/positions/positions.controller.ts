import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PositionsService } from './positions.service';
import { CreatePositionDto, UpdatePositionDto } from './dto/position.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Positions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('positions')
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Post()
  @RequirePermissions('positions:create')
  @ApiOperation({ summary: 'Create position' })
  create(@Body() dto: CreatePositionDto) {
    return this.positionsService.create(dto);
  }

  @Get()
  @RequirePermissions('positions:read')
  @ApiOperation({ summary: 'Get all positions' })
  findAll() {
    return this.positionsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('positions:read')
  @ApiOperation({ summary: 'Get position by ID' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.positionsService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('positions:update')
  @ApiOperation({ summary: 'Update position' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePositionDto) {
    return this.positionsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('positions:delete')
  @ApiOperation({ summary: 'Delete position' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.positionsService.remove(id);
  }
}
