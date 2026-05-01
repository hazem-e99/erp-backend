import { IsMongoId, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpsertAllPayrollReminderDto {
  @IsNumber()
  @Min(1)
  @Max(31)
  dayOfMonth: number;
}

export class UpsertInternPayrollReminderDto {
  @IsMongoId()
  employeeId: string;

  @IsNumber()
  @Min(1)
  @Max(31)
  dayOfMonth: number;
}
