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
  PayloadTooLargeException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { ExpensesService } from '../services/expenses.service';
import { CreateExpenseDto } from '../dto/create-expense.dto';
import { UpdateExpenseDto } from '../dto/update-expense.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const expenseFileStorage = diskStorage({
  destination: join(process.cwd(), 'uploads', 'expenses'),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `expense-${unique}${extname(file.originalname)}`);
  },
});

const ensureWithinSize = (file?: Express.Multer.File) => {
  if (file && file.size > MAX_ATTACHMENT_BYTES) {
    throw new PayloadTooLargeException(
      `Attachment exceeds the 20 MB limit (got ${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
    );
  }
};

@Controller('finance/expenses')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @RequirePermissions('finance:create')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('attachment', {
      storage: expenseFileStorage,
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  async create(
    @Body() dto: CreateExpenseDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    ensureWithinSize(file);
    const attachmentUrl = file
      ? `/uploads/expenses/${file.filename}`
      : undefined;
    return this.expensesService.create(dto, attachmentUrl);
  }

  @Put(':id')
  @RequirePermissions('finance:update')
  @UseInterceptors(
    FileInterceptor('attachment', {
      storage: expenseFileStorage,
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    ensureWithinSize(file);
    const attachmentUrl = file
      ? `/uploads/expenses/${file.filename}`
      : undefined;
    return this.expensesService.update(id, dto, attachmentUrl);
  }

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.expensesService.findAll(query);
  }

  @Get('by-category')
  @RequirePermissions('finance:read')
  getByCategory(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.expensesService.getByCategory(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('chart')
  @RequirePermissions('finance:read')
  getMonthlyChart(@Query('year') year?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.expensesService.getMonthlyChart(y);
  }

  @Delete(':id')
  @RequirePermissions('finance:delete')
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.expensesService.delete(id);
  }
}
