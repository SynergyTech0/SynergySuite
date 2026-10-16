import { IsString, IsEnum, IsOptional, IsNumber, IsUrl, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JurisdictionType } from './tax-rate.dto';

export enum FilingFrequency {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUALLY = 'ANNUALLY',
  SEMIANNUALLY = 'SEMIANNUALLY',
}

export class CreateTaxAgencyDto {
  @ApiProperty({ description: 'Tax agency name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Jurisdiction name' })
  @IsString()
  jurisdiction: string;

  @ApiProperty({ enum: JurisdictionType, description: 'Type of jurisdiction' })
  @IsEnum(JurisdictionType)
  jurisdictionType: JurisdictionType;

  @ApiProperty({ enum: FilingFrequency, description: 'Filing frequency' })
  @IsEnum(FilingFrequency)
  filingFrequency: FilingFrequency;

  @ApiPropertyOptional({ description: 'Account number with the agency' })
  @IsString()
  @IsOptional()
  accountNumber?: string;

  @ApiPropertyOptional({ description: 'Filing method (e.g., online, mail)' })
  @IsString()
  @IsOptional()
  filingMethod?: string;

  @ApiPropertyOptional({ description: 'Payment method (e.g., ACH, check)' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: 'Day of month when filing is due', minimum: 1, maximum: 31 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  dueDayOfMonth?: number;

  @ApiPropertyOptional({ description: 'Grace period in days', minimum: 0, default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  gracePeriodDays?: number;

  @ApiPropertyOptional({ description: 'Liability account ID for tax payable' })
  @IsString()
  @IsOptional()
  liabilityAccountId?: string;

  @ApiPropertyOptional({ description: 'Expense account ID for tax expense' })
  @IsString()
  @IsOptional()
  expenseAccountId?: string;

  @ApiPropertyOptional({ description: 'Agency website URL' })
  @IsUrl()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ description: 'Agency phone number' })
  @IsString()
  @IsOptional()
  phone?: string;
}
