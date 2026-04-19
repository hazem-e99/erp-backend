import {
  IsString, IsEnum, IsDateString, IsOptional, IsNumber, Min, Max,
} from 'class-validator';
import { PaymentMethod } from '../schemas/payment.schema';
import { SupportedCurrency } from '../constants/currency.constants';
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

  @IsEnum(SupportedCurrency, {
    message: 'Currency must be a valid supported currency (EGP, USD, SAR, EUR, GBP, AED)',
  })
  currency: SupportedCurrency;

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
