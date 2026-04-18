import {
  IsString, IsNumber, IsEnum, IsDateString,
  IsOptional, Min,
} from 'class-validator';
import { PaymentMethod } from '../schemas/payment.schema';

export class CreatePaymentDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  installmentId: string;

  @IsString()
  clientId: string;

  @IsString()
  clientName: string;

  @IsNumber()
  @Min(0.01)
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
