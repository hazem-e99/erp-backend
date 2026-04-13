import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';


@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get('my')
  @ApiOperation({ summary: 'Get my assigned tasks only' })
  getMyTasks(@CurrentUser('_id') userId: string, @Query() query: any) {
    return this.tasksService.findMyTasks(userId, query);
  }

  @Get()
  @RequirePermissions('tasks:read')
  @ApiOperation({ summary: 'Get all tasks (managers/admins only)' })
  findAll(
    @CurrentUser() user: any,
    @Query() query: any,
  ) {
    // If user has tasks:manage - see all. Otherwise only their own tasks.
    const canSeeAll = user?.role?.permissions?.includes('tasks:manage') ||
                      user?.role?.permissions?.includes('tasks:read') &&
                      user?.role?.permissions?.includes('dashboard:admin');
    if (!canSeeAll) {
      return this.tasksService.findMyTasks(user._id, query);
    }
    return this.tasksService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('tasks:read')
  @ApiOperation({ summary: 'Get task stats' })
  getStats() {
    return this.tasksService.getStats();
  }

  @Get('employee/:employeeId')
  @RequirePermissions('tasks:read')
  @ApiOperation({ summary: 'Get tasks by employee' })
  findByEmployee(@Param('employeeId', ParseObjectIdPipe) employeeId: string, @Query() query: any) {
    return this.tasksService.findByEmployee(employeeId, query);
  }

  @Get(':id')
  @RequirePermissions('tasks:read')
  @ApiOperation({ summary: 'Get task by ID' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.tasksService.findById(id);
  }

  @Post()
  @RequirePermissions('tasks:create')
  @ApiOperation({ summary: 'Create task' })
  create(@Body() dto: CreateTaskDto, @CurrentUser('_id') userId: string) {
    return this.tasksService.create(dto, userId);
  }

  @Put(':id')
  @RequirePermissions('tasks:update')
  @ApiOperation({ summary: 'Update task' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('tasks:delete')
  @ApiOperation({ summary: 'Delete task' })
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.tasksService.delete(id);
  }
}
