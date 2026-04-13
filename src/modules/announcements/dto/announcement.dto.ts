import { IsNotEmpty, IsString, IsArray, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'Office Closure Notice' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'The office will be closed on Friday for maintenance.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ enum: ['all', 'users', 'roles', 'departments', 'projects'] })
  @IsEnum(['all', 'users', 'roles', 'departments', 'projects'])
  targetType: string;

  @ApiPropertyOptional({ example: ['userId1', 'userId2'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetIds?: string[];
}
