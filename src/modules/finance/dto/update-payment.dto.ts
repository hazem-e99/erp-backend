import {
  IsString,
  IsEnum,
  IsDateString,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../schemas/payment.schema';

/**
 * Edits are limited to metadata fields that don't affect the
 * installment/subscription allocation math (paidAmount, status, etc.).
 * To change `amount` or move to a different installment, delete the
 * payment and create a new one.
 */
export class UpdatePaymentDto {
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    {
      message:
        'Gate fee percentage must be a number with at most 2 decimal places',
    },
  )
  @Min(0, { message: 'Gate fee percentage cannot be negative' })
  @Max(100, { message: 'Gate fee percentage cannot exceed 100' })
  gateFeePercentage?: number;
}
