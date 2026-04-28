import { IsString, IsNotEmpty, IsOptional, IsNumber, IsDate, IsArray, IsEnum, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReminderDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsDate()
  @Type(() => Date)
  reminderDate: Date;

  @IsArray()
  @IsOptional()
  reminderPeriods?: string[]; // ['7days', '3days', '24hours', 'sameday']

  @IsBoolean()
  @IsOptional()
  isMonthlyRecurring?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(31)
  monthlyDay?: number; // Day of the month (1-31)
}

export class UpdateReminderDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  reminderDate?: Date;

  @IsArray()
  @IsOptional()
  reminderPeriods?: string[];

  @IsBoolean()
  @IsOptional()
  isMonthlyRecurring?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(31)
  monthlyDay?: number;

  @IsEnum(['pending', 'completed', 'cancelled'])
  @IsOptional()
  status?: string;
}
