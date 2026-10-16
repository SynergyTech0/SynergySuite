import { IsString, IsNumber, IsEnum, IsBoolean, IsOptional, IsDateString, IsArray, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum JurisdictionType {
  FEDERAL = 'FEDERAL',
  STATE = 'STATE',
  COUNTY = 'COUNTY',
  CITY = 'CITY',
  DISTRICT = 'DISTRICT',
  SPECIAL = 'SPECIAL',
}

export class CreateTaxRateDto {
  @ApiProperty({ description: 'Tax rate name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Jurisdiction name (e.g., CA, Los Angeles)' })
  @IsString()
  jurisdiction: string;

  @ApiProperty({ enum: JurisdictionType, description: 'Type of jurisdiction' })
  @IsEnum(JurisdictionType)
  jurisdictionType: JurisdictionType;

  @ApiProperty({ description: 'Tax rate as decimal (e.g., 0.0825 for 8.25%)', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  rate: number;

  @ApiPropertyOptional({ description: 'Whether this is a compound tax', default: false })
  @IsBoolean()
  @IsOptional()
  isCompound?: boolean;

  @ApiProperty({ description: 'Effective date of the tax rate' })
  @IsDateString()
  effectiveDate: string;

  @ApiPropertyOptional({ description: 'End date of the tax rate' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'ZIP codes where this rate applies', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  zipCodes?: string[];

  @ApiPropertyOptional({ description: 'County FIPS code' })
  @IsString()
  @IsOptional()
  countyFips?: string;

  @ApiPropertyOptional({ description: 'State FIPS code' })
  @IsString()
  @IsOptional()
  stateFips?: string;
}

export class UpdateTaxRateDto {
  @ApiPropertyOptional({ description: 'Tax rate name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Tax rate as decimal', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  rate?: number;

  @ApiPropertyOptional({ description: 'Whether this is a compound tax' })
  @IsBoolean()
  @IsOptional()
  isCompound?: boolean;

  @ApiPropertyOptional({ description: 'Effective date of the tax rate' })
  @IsDateString()
  @IsOptional()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'End date of the tax rate' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'ZIP codes where this rate applies', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  zipCodes?: string[];
}
