import {
  IsString, IsNumber, IsEnum, IsDateString, Min, IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseCategory } from '../schemas/expense.schema';

export class CreateExpenseDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsDateString()
  date: string;

  @IsString()
  description: string;
}
