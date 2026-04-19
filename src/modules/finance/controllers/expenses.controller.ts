import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { ExpensesService } from '../services/expenses.service';
import { CreateExpenseDto } from '../dto/create-expense.dto';
import { PaginationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

@Controller('finance/expenses')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @RequirePermissions('finance:create')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('attachment', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'expenses'),
        filename: (_req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `expense-${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Only JPEG, PNG, WebP, and PDF are allowed'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  async create(
    @Body() dto: CreateExpenseDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const attachmentUrl = file ? `/uploads/expenses/${file.filename}` : undefined;
    return this.expensesService.create(dto, attachmentUrl);
  }

  @Get()
  @RequirePermissions('finance:read')
  findAll(@Query() query: PaginationQueryDto) {
    return this.expensesService.findAll(query);
  }

  @Get('by-category')
  @RequirePermissions('finance:read')
  getByCategory(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
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
