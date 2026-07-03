import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PaymentsService } from '../services/payments.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { UpdatePaymentDto } from '../dto/update-payment.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';
import { DriveAttachmentsService } from '../../backup/drive-attachments.service';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const ensureWithinSize = (file?: Express.Multer.File) => {
  if (file && file.size > MAX_ATTACHMENT_BYTES) {
    throw new PayloadTooLargeException(
      `Attachment exceeds the 20 MB limit (got ${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
    );
  }
};

@Controller('finance/payments')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly attachments: DriveAttachmentsService,
  ) {}

  @Post()
  @RequirePermissions('finance:create')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('attachment', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  async create(
    @Body() dto: CreatePaymentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    ensureWithinSize(file);
    if (!file) {
      throw new BadRequestException('Payment attachment is required');
    }
    const attachmentUrl = await this.attachments.upload(file, 'payments');
    const { payment, overflow } = await this.paymentsService.create(
      dto,
      attachmentUrl,
    );
    return { payment, overflow };
  }

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.paymentsService.findAll(query);
  }

  @Put(':id')
  @RequirePermissions('finance:update')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.paymentsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('finance:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.paymentsService.delete(id);
  }
}
