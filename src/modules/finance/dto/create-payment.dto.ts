import {
  IsString, IsEnum, IsDateString, IsOptional,
} from 'class-validator';
import { PaymentMethod } from '../schemas/payment.schema';
import { IsFinancialAmount } from '../validators/finance.validators';

export class CreatePaymentDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  installmentId: string;

  @IsString()
  clientId: string;

  @IsString()
  clientName: string;

  @IsFinancialAmount(1_000_000, {
    message: 'Payment amount must be greater than 0 and cannot exceed 1,000,000 (max 2 decimal places)',
  })
  amount: number;

  @IsDateString()
  paymentDate: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
