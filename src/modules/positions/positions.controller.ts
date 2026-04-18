import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PositionsService } from './positions.service';
import { CreatePositionDto, UpdatePositionDto } from './dto/position.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Positions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('positions')
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create position' })
  create(@Body() dto: CreatePositionDto) {
    return this.positionsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all positions' })
  findAll() {
    return this.positionsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get position by ID' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.positionsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update position' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePositionDto) {
    return this.positionsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete position' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.positionsService.remove(id);
  }
}
