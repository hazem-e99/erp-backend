import {
  IsString, IsEnum, IsDateString, IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseCategory } from '../schemas/expense.schema';
import { IsFinancialAmount } from '../validators/finance.validators';

export class CreateExpenseDto {
  @Type(() => Number)
  @IsFinancialAmount(500_000, {
    message: 'Expense amount must be greater than 0 and cannot exceed 500,000 (max 2 decimal places)',
  })
  amount: number;

  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsDateString()
  date: string;

  @IsString()
  description: string;
}
