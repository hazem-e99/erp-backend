import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CommissionService } from './commission.service';
import {
  ApproveCommissionDto,
  CommissionsQueryDto,
} from './dto/commission.dto';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-objectid.pipe';
import { DriveAttachmentsService } from '../backup/drive-attachments.service';

@ApiTags('Commissions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('payroll/commissions')
export class CommissionController {
  constructor(
    private readonly service: CommissionService,
    private readonly attachments: DriveAttachmentsService,
  ) {}

  @Get()
  @RequirePermissions('payroll:read')
  findAll(@Query() query: CommissionsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('payroll:read')
  findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.findById(id);
  }

  @Patch(':id/approve')
  @RequirePermissions('payroll:update')
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: memoryStorage(),
      // Accept any file type — restriction caused legitimate uploads to be rejected
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    }),
  )
  async approve(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ApproveCommissionDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('_id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Transfer screenshot is required to approve a commission',
      );
    }
    const screenshotPath = await this.attachments.upload(file, 'commissions');
    return this.service.approve(id, dto, userId ?? null, screenshotPath);
  }

  @Delete(':id')
  @RequirePermissions('payroll:update')
  cancel(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.cancel(id);
  }
}
