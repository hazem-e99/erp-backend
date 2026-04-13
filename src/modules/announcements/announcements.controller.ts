import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/announcement.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';

@ApiTags('Announcements & Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller()
export class AnnouncementsController {
  constructor(private service: AnnouncementsService) {}

  // ─── Announcement Endpoints (send_announcement permission) ───

  @Post('announcements')
  @RequirePermissions('announcements:send')
  @ApiOperation({ summary: 'Create & send announcement' })
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser('_id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Get('announcements')
  @RequirePermissions('announcements:send')
  @ApiOperation({ summary: 'List all announcements (admin)' })
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('announcements/:id')
  @RequirePermissions('announcements:send')
  @ApiOperation({ summary: 'Get announcement details' })
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.findById(id);
  }

  // ─── Notification Endpoints (any authenticated user) ───

  @Get('notifications')
  @ApiOperation({ summary: 'Get my notifications' })
  getMyNotifications(@CurrentUser('_id') userId: string, @Query() query: any) {
    return this.service.getMyNotifications(userId, query);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  getUnreadCount(@CurrentUser('_id') userId: string) {
    return this.service.getUnreadCount(userId);
  }

  @Put('notifications/:id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  markAsRead(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser('_id') userId: string) {
    return this.service.markAsRead(id, userId);
  }

  @Put('notifications/read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(@CurrentUser('_id') userId: string) {
    return this.service.markAllAsRead(userId);
  }

  @Delete('notifications/:id')
  @ApiOperation({ summary: 'Delete a notification' })
  deleteNotification(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser('_id') userId: string) {
    return this.service.deleteNotification(id, userId);
  }
}
