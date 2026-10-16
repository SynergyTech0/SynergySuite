import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FileTaxReturnDto {
  @ApiProperty({ description: 'Name of person filing the return' })
  @IsString()
  filedBy: string;

  @ApiProperty({ description: 'Filing method (e.g., online, mail, fax)' })
  @IsString()
  filingMethod: string;

  @ApiPropertyOptional({ description: 'Confirmation number from filing' })
  @IsString()
  @IsOptional()
  confirmationNumber?: string;

  @ApiPropertyOptional({ description: 'Payment amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  paymentAmount?: number;

  @ApiPropertyOptional({ description: 'Payment method (e.g., ACH, check, credit card)' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: 'Payment reference or transaction ID' })
  @IsString()
  @IsOptional()
  paymentReference?: string;
}
