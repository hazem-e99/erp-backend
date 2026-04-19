import {
  IsString, IsEnum, IsDateString, IsNotEmpty, IsNumber, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseCategory } from '../schemas/expense.schema';
import { SupportedCurrency } from '../constants/currency.constants';
import { IsFinancialAmount } from '../validators/finance.validators';

export class CreateExpenseDto {
  @Type(() => Number)
  @IsFinancialAmount(500_000, {
    message: 'Expense amount must be greater than 0 and cannot exceed 500,000 (max 2 decimal places)',
  })
  amount: number;

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

  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsDateString()
  date: string;

  @IsString()
  description: string;
}
