import { IsNotEmpty, IsOptional, IsString, IsNumber, IsDateString, IsEmail, IsArray, IsEnum, MinLength, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportedCurrency } from '../../finance/constants/currency.constants';
import { MaxDecimalPlaces } from '../../finance/validators/finance.validators';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Ahmed Hassan' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'EMP001' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'ahmed@company.com' })
  @IsEmail()
  emailAddress: string;

  @ApiProperty({ example: 'Password@123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 28 })
  @IsOptional()
  @IsNumber()
  age?: number;

  @ApiPropertyOptional({ example: 'EGP', enum: ['EGP', 'USD', 'SAR', 'EUR', 'GBP', 'AED'] })
  @IsOptional()
  @IsEnum(SupportedCurrency)
  currency?: SupportedCurrency;

  @ApiPropertyOptional({ example: 1, description: 'Exchange rate to base currency (EGP)' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(10000)
  @MaxDecimalPlaces(4)
  exchangeRate?: number;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  baseSalary: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @IsNumber()
  maxKpi?: number;

  @ApiProperty({ example: '2024-01-15' })
  @IsDateString()
  dateOfJoining: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: '+201234567890' })
  @IsOptional()
  @IsString()
  emergencyContact?: string;

  @ApiPropertyOptional({ example: '+201098765432' })
  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  // Multi-select arrays
  @ApiPropertyOptional({ example: ['Developer', 'Team Lead'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  positions?: string[];

  @ApiPropertyOptional({ example: ['Engineering', 'QA'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departments?: string[];

  @ApiPropertyOptional({ example: ['Full-time'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contractTypes?: string[];

  @ApiPropertyOptional({ enum: ['mobile_wallet', 'visa', 'bank_account', 'instapay'] })
  @IsOptional()
  @IsEnum(['mobile_wallet', 'visa', 'bank_account', 'instapay'])
  paymentMethodType?: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  @IsOptional()
  @IsString()
  paymentMethodDetails?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyContact?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ enum: ['EGP', 'USD', 'SAR', 'EUR', 'GBP', 'AED'] })
  @IsOptional()
  @IsEnum(SupportedCurrency)
  currency?: SupportedCurrency;

  @ApiPropertyOptional({ description: 'Exchange rate to base currency (EGP)' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(10000)
  @MaxDecimalPlaces(4)
  exchangeRate?: number;

  // Admin-only fields (enforced in service)
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  baseSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxKpi?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  age?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  positions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departments?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contractTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['active', 'inactive', 'terminated'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  annualLeaves?: number;

  @ApiPropertyOptional({ enum: ['mobile_wallet', 'visa', 'bank_account', 'instapay'] })
  @IsOptional()
  @IsEnum(['mobile_wallet', 'visa', 'bank_account', 'instapay'])
  paymentMethodType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethodDetails?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappNumber?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  oldPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class AdminResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(6)
  newPassword: string;
}
