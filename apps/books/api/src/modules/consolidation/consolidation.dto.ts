import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const CURRENCY = /^[A-Za-z]{3}$/;

export class CreateGroupDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY, { message: 'reportingCurrency must be a three-letter code like USD' })
  reportingCurrency: string;

  @ApiProperty({ description: 'Its chart of accounts names the consolidated lines' })
  @IsString()
  parentOrganizationId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  organizationIds: string[];
}

export class UpdateGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CURRENCY, { message: 'reportingCurrency must be a three-letter code like USD' })
  reportingCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  parentOrganizationId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  organizationIds?: string[];
}

export class CreateIntercompanyDto {
  @ApiProperty({ enum: ['CHARGE', 'LOAN', 'SETTLEMENT'] })
  @IsIn(['CHARGE', 'LOAN', 'SETTLEMENT'])
  kind: 'CHARGE' | 'LOAN' | 'SETTLEMENT';

  @ApiProperty()
  @IsDateString()
  date: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @ApiProperty({ description: 'The company that is owed (holds the receivable)' })
  @IsString()
  fromOrganizationId: string;

  @ApiProperty({ description: 'The company that owes (holds the payable)' })
  @IsString()
  toOrganizationId: string;

  @ApiProperty({ description: "In the from company: income for a charge, bank for a loan or settlement" })
  @IsString()
  fromAccountId: string;

  @ApiProperty({ description: 'In the to company: expense or asset for a charge, bank for a loan or settlement' })
  @IsString()
  toAccountId: string;

  @ApiProperty({ description: "In the from company's currency" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: "In the to company's currency; defaults to amount at the day's rate" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  toAmount?: number;
}

export class SetRateDto {
  @ApiProperty({ example: 'EUR' })
  @Matches(CURRENCY, { message: 'fromCurrency must be a three-letter code like EUR' })
  fromCurrency: string;

  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY, { message: 'toCurrency must be a three-letter code like USD' })
  toCurrency: string;

  @ApiProperty({ description: 'One fromCurrency buys this many toCurrency' })
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  rate: number;

  @ApiProperty()
  @IsDateString()
  effectiveDate: string;
}
