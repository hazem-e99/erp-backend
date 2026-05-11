import {
  IsString, IsEnum, IsDateString,
  IsOptional, IsArray, ArrayMinSize, ArrayMaxSize,
  IsNotEmpty, IsMongoId, ValidateNested, IsNumber, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InstallmentPlan, PlanType } from '../schemas/subscription.schema';
import { SupportedCurrency } from '../constants/currency.constants';
import { IsFinancialAmount } from '../validators/finance.validators';

export class CommissionAssignmentDto {
  @IsMongoId()
  employeeId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, {
    message: 'Commission percentage must be a number with at most 2 decimal places',
  })
  @Min(0.01, { message: 'Commission percentage must be greater than 0' })
  @Max(100, { message: 'Commission percentage cannot exceed 100' })
  percentage: number;
}

export class InstallmentItemDto {
  @Type(() => Number)
  @IsFinancialAmount(1_000_000, {
    message: 'Each installment amount must be greater than 0 and cannot exceed 1,000,000 (max 2 decimal places)',
  })
  amount: number;

  @IsDateString()
  dueDate: string;
}

export class CreateSubscriptionDto {
  @IsMongoId()
  @IsNotEmpty()
  clientId: string;

  @IsString()
  @IsNotEmpty()
  clientName: string;

  @IsEnum(PlanType)
  planType: PlanType;

  /** Required only for full payment plan. Derived from installmentItems for other plans. */
  @IsOptional()
  @IsFinancialAmount(1_000_000, {
    message: 'Total price must be greater than 0 and cannot exceed 1,000,000 (max 2 decimal places)',
  })
  totalPrice?: number;

  @IsEnum(SupportedCurrency, {
    message: 'Currency must be a valid supported currency (EGP, USD, SAR, EUR, GBP, AED)',
  })
  currency: SupportedCurrency;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 }, {
    message: 'Exchange rate must be a number with at most 4 decimal places',
  })
  @Min(0.0001, {
    message: 'Exchange rate must be at least 0.0001',
  })
  @Max(10000, {
    message: 'Exchange rate cannot exceed 10,000',
  })
  exchangeRate: number;

  @IsDateString()
  startDate: string;

  @IsEnum(InstallmentPlan)
  installmentPlan: InstallmentPlan;

  /** Required for split_2 and custom plans. Each item has amount + dueDate. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => InstallmentItemDto)
  installmentItems?: InstallmentItemDto[];

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, {
    message: 'Gate fee percentage must be a number with at most 2 decimal places',
  })
  @Min(0, { message: 'Gate fee percentage cannot be negative' })
  @Max(100, { message: 'Gate fee percentage cannot exceed 100' })
  gateFeePercentage?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommissionAssignmentDto)
  commissions?: CommissionAssignmentDto[];
}
