import {
  IsString, IsNumber, IsEnum, IsDateString,
  IsOptional, Min, IsArray, ArrayMinSize, ArrayMaxSize,
  IsNotEmpty, IsMongoId, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InstallmentPlan, PlanType } from '../schemas/subscription.schema';

export class InstallmentItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
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
  @IsNumber()
  @Min(0.01)
  totalPrice?: number;

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
}
