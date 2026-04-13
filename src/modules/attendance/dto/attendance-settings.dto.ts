import { IsString, IsOptional, IsNumber, IsEnum, Min, Max, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdateAttendanceSettingsDto {
  @ApiProperty({ example: '09:00', description: 'Work start time (HH:mm 24h)' })
  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'workStartTime must be HH:mm' })
  workStartTime?: string;

  @ApiProperty({ example: '17:00', description: 'Work end time (HH:mm 24h)' })
  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'workEndTime must be HH:mm' })
  workEndTime?: string;

  @ApiProperty({ example: 5, description: 'Grace period in minutes' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(60)
  gracePeriodMinutes?: number;

  @ApiProperty({ example: 8, description: 'Standard hours per day' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  standardHours?: number;

  @ApiProperty({ enum: ['full-time', 'part-time', 'flexible'] })
  @IsOptional()
  @IsEnum(['full-time', 'part-time', 'flexible'])
  shiftType?: 'full-time' | 'part-time' | 'flexible';

  @ApiProperty({ example: 'Default Work Schedule' })
  @IsOptional()
  @IsString()
  label?: string;
}
