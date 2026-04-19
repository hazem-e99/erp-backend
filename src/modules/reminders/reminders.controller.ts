import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RemindersService } from './reminders.service';
import { EmailService } from '../email/email.service';
import { CreateReminderDto, UpdateReminderDto } from './dto/reminder.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('reminders')
@Controller('reminders')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class RemindersController {
  constructor(
    private readonly remindersService: RemindersService,
    private readonly emailService: EmailService,
  ) {}

  @Post()
  @RequirePermissions('reminders:create')
  @ApiOperation({ summary: 'Create a new reminder' })
  create(@Body() createReminderDto: CreateReminderDto, @CurrentUser('userId') userId: string) {
    return this.remindersService.create(createReminderDto, userId);
  }

  @Get()
  @RequirePermissions('reminders:read')
  @ApiOperation({ summary: 'Get all reminders for current user' })
  findAll(@CurrentUser('userId') userId: string) {
    return this.remindersService.findAll(userId);
  }

  @Get(':id')
  @RequirePermissions('reminders:read')
  @ApiOperation({ summary: 'Get a specific reminder' })
  findOne(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.remindersService.findOne(id, userId);
  }

  @Put(':id')
  @RequirePermissions('reminders:update')
  @ApiOperation({ summary: 'Update a reminder' })
  update(
    @Param('id') id: string,
    @Body() updateReminderDto: UpdateReminderDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.remindersService.update(id, updateReminderDto, userId);
  }

  @Delete(':id')
  @RequirePermissions('reminders:delete')
  @ApiOperation({ summary: 'Delete a reminder' })
  remove(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.remindersService.remove(id, userId);
  }

  @Post('test-email')
  @ApiOperation({ summary: 'Test email sending (for debugging)' })
  async testEmail(@CurrentUser('userId') userId: string) {
    try {
      console.log('📧 Testing email sending...');
      
      // Send a test email
      await this.emailService.sendReminderEmail(
        'hazem@intlakaa.com',
        'تذكير تجريبي من نظام ERP',
        {
          title: 'اختبار إرسال البريد الإلكتروني',
          description: 'هذا email تجريبي للتأكد من عمل نظام الإشعارات',
          amount: 1000,
          reminderDate: new Date(),
          period: 'sameday',
        }
      );
      
      console.log('✅ Test email sent successfully to hazem@intlakaa.com');
      return { 
        success: true, 
        message: 'Test email sent to hazem@intlakaa.com',
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ Failed to send test email:', error);
      throw error;
    }
  }
}
