import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeavesService } from './leaves.service';
import { CreateLeaveDto, ApproveLeaveDto } from './dto/leave.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Leaves')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('leaves')
export class LeavesController {
  constructor(private leavesService: LeavesService) {}

  @Post('apply')
  @RequirePermissions('leaves:create')
  @ApiOperation({ summary: 'Apply for leave' })
  apply(@CurrentUser('_id') userId: string, @Body() dto: CreateLeaveDto) {
    return this.leavesService.apply(userId, dto);
  }

  // `/me` must come before `/:id`
  @Get('me')
  @RequirePermissions('leaves:read')
  @ApiOperation({ summary: 'Get my leaves' })
  getMyLeaves(@CurrentUser('_id') userId: string) {
    return this.leavesService.getMyLeaves(userId);
  }

  @Get()
  @RequirePermissions('leaves:read')
  @ApiOperation({ summary: 'Get all leave requests' })
  findAll(@Query() query: any) {
    return this.leavesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('leaves:read')
  @ApiOperation({ summary: 'Get leave by ID' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.leavesService.findById(id);
  }

  @Post(':id/approve')
  @RequirePermissions('leaves:approve')
  @ApiOperation({ summary: 'Approve or reject leave' })
  approve(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ApproveLeaveDto,
    @CurrentUser('_id') userId: string,
  ) {
    return this.leavesService.approve(id, dto, userId);
  }
}
