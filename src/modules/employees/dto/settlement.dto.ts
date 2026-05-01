import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateEmployeeSettlementDto {
  @IsDateString()
  terminationDate: string;

  @IsDateString()
  lastWorkingDay: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accruedSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonuses?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deductions?: number;

  @IsOptional()
  @IsNumber()
  otherAdjustments?: number;

  @IsOptional()
  notes?: string;
}
