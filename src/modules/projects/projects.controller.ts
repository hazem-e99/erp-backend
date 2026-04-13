import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  @RequirePermissions('projects:read')
  @ApiOperation({ summary: 'Get all projects' })
  findAll(@Query() query: any) {
    return this.projectsService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('projects:read')
  @ApiOperation({ summary: 'Get project stats' })
  getStats() {
    return this.projectsService.getStats();
  }

  @Get(':id')
  @RequirePermissions('projects:read')
  @ApiOperation({ summary: 'Get project by ID' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.projectsService.findById(id);
  }

  @Post()
  @RequirePermissions('projects:create')
  @ApiOperation({ summary: 'Create project' })
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Put(':id')
  @RequirePermissions('projects:update')
  @ApiOperation({ summary: 'Update project' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('projects:delete')
  @ApiOperation({ summary: 'Delete project' })
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.projectsService.delete(id);
  }
}
