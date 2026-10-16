import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum PeriodType {
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
  CUSTOM = 'CUSTOM',
}

export enum PeriodStatus {
  FUTURE = 'FUTURE',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LOCKED = 'LOCKED',
}

export class CreateFiscalPeriodDto {
  @ApiProperty({ description: 'Period name (e.g., "January 2024")' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: PeriodType, description: 'Type of fiscal period' })
  @IsEnum(PeriodType)
  type: PeriodType;

  @ApiProperty({ description: 'Period start date' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'Period end date' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ enum: PeriodStatus, description: 'Period status' })
  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;

  @ApiPropertyOptional({ description: 'Fiscal year identifier' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fiscalYear?: string;

  @ApiPropertyOptional({ description: 'Period number within fiscal year' })
  @IsOptional()
  periodNumber?: number;
}

export class UpdateFiscalPeriodDto {
  @ApiPropertyOptional({ description: 'Period name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: PeriodStatus, description: 'Period status' })
  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;
}

export class GenerateFiscalPeriodsDto {
  @ApiProperty({ description: 'Fiscal year start date' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ enum: PeriodType, description: 'Period type to generate' })
  @IsEnum(PeriodType)
  periodType: PeriodType;

  @ApiPropertyOptional({ description: 'Fiscal year identifier' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fiscalYear?: string;
}

export class FiscalPeriodResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: PeriodType })
  type: PeriodType;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty({ enum: PeriodStatus })
  status: PeriodStatus;

  @ApiPropertyOptional()
  fiscalYear?: string;

  @ApiPropertyOptional()
  periodNumber?: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
