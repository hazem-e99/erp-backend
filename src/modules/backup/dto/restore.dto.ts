import { IsNotEmpty, IsString } from 'class-validator';

export class RestoreDto {
  @IsString()
  @IsNotEmpty()
  confirmPhrase!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RestoreExistingDto extends RestoreDto {
  @IsString()
  @IsNotEmpty()
  backupId!: string;
}
