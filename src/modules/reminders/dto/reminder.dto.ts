import { IsString, IsNotEmpty, IsOptional, IsNumber, IsDate, IsArray, IsEnum } from 'class-validator';
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

  @IsEnum(['pending', 'completed', 'cancelled'])
  @IsOptional()
  status?: string;
}
