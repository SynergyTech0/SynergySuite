import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum EntityType {
  SOLE_PROPRIETORSHIP = 'SOLE_PROPRIETORSHIP',
  PARTNERSHIP = 'PARTNERSHIP',
  LLC = 'LLC',
  S_CORP = 'S_CORP',
  C_CORP = 'C_CORP',
  NON_PROFIT = 'NON_PROFIT',
  TRUST = 'TRUST',
  ESTATE = 'ESTATE',
}

export enum AccountingMethod {
  CASH = 'CASH',
  ACCRUAL = 'ACCRUAL',
}

export class CreateOrganizationDto {
  @ApiProperty({ description: 'Organization name' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Legal name if different from name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @ApiPropertyOptional({ description: 'Employer Identification Number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ein?: string;

  @ApiProperty({ enum: EntityType, description: 'Business entity type' })
  @IsEnum(EntityType)
  entityType: EntityType;

  @ApiProperty({ enum: AccountingMethod, description: 'Accounting method' })
  @IsEnum(AccountingMethod)
  accountingMethod: AccountingMethod;

  @ApiPropertyOptional({ description: 'Fiscal year end month (1-12)' })
  @IsOptional()
  fiscalYearEnd?: number;

  @ApiPropertyOptional({ description: 'State of incorporation' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  stateOfIncorporation?: string;

  @ApiPropertyOptional({ description: 'Primary industry' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({ description: 'NAICS code' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  naicsCode?: string;

  @ApiPropertyOptional({ description: 'Default currency code' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'Organization settings' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ description: 'Organization name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Legal name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @ApiPropertyOptional({ description: 'Employer Identification Number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ein?: string;

  @ApiPropertyOptional({ enum: EntityType, description: 'Business entity type' })
  @IsOptional()
  @IsEnum(EntityType)
  entityType?: EntityType;

  @ApiPropertyOptional({ enum: AccountingMethod, description: 'Accounting method' })
  @IsOptional()
  @IsEnum(AccountingMethod)
  accountingMethod?: AccountingMethod;

  @ApiPropertyOptional({ description: 'Fiscal year end month' })
  @IsOptional()
  fiscalYearEnd?: number;

  @ApiPropertyOptional({ description: 'State of incorporation' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  stateOfIncorporation?: string;

  @ApiPropertyOptional({ description: 'Primary industry' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({ description: 'NAICS code' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  naicsCode?: string;

  @ApiPropertyOptional({ description: 'Default currency code' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'Organization settings' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Is organization active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OrganizationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  legalName?: string;

  @ApiPropertyOptional()
  ein?: string;

  @ApiProperty({ enum: EntityType })
  entityType: EntityType;

  @ApiProperty({ enum: AccountingMethod })
  accountingMethod: AccountingMethod;

  @ApiPropertyOptional()
  fiscalYearEnd?: number;

  @ApiPropertyOptional()
  stateOfIncorporation?: string;

  @ApiPropertyOptional()
  industry?: string;

  @ApiPropertyOptional()
  naicsCode?: string;

  @ApiProperty()
  defaultCurrency: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
