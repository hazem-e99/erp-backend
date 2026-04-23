import { IsNotEmpty, IsOptional, IsString, IsNumber, IsMongoId, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeneratePayrollDto {
  @ApiProperty()
  @IsMongoId()
  employeeId: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  month: number;

  @ApiProperty({ example: 2026 })
  @IsNumber()
  year: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  bonuses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  commissions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deductions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxKpi?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  kpiPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePayrollDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  bonuses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  commissions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deductions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxKpi?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  kpiPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transferScreenshot?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transactionNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['draft', 'processed', 'paid'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
