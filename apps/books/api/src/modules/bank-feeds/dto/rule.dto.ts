import { IsString, IsEnum, IsOptional, IsNumber, IsBoolean, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TransactionType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export class CreateRuleDto {
  @ApiProperty({ description: 'Rule name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Description contains text (case-insensitive)' })
  @IsString()
  @IsOptional()
  descriptionContains?: string;

  @ApiPropertyOptional({ description: 'Description regex pattern' })
  @IsString()
  @IsOptional()
  descriptionPattern?: string;

  @ApiPropertyOptional({ description: 'Merchant name (exact match)' })
  @IsString()
  @IsOptional()
  merchantName?: string;

  @ApiPropertyOptional({ description: 'Minimum transaction amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  minAmount?: number;

  @ApiPropertyOptional({ description: 'Maximum transaction amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxAmount?: number;

  @ApiPropertyOptional({ enum: TransactionType, description: 'Transaction type filter' })
  @IsEnum(TransactionType)
  @IsOptional()
  transactionType?: TransactionType;

  @ApiPropertyOptional({ description: 'Target GL account ID' })
  @IsString()
  @IsOptional()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Tax classification' })
  @IsString()
  @IsOptional()
  taxClassification?: string;

  @ApiPropertyOptional({ description: 'Vendor ID for auto-matching' })
  @IsString()
  @IsOptional()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'Customer ID for auto-matching' })
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Class ID for tracking' })
  @IsString()
  @IsOptional()
  classId?: string;

  @ApiPropertyOptional({ description: 'Location ID for tracking' })
  @IsString()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Memo to apply' })
  @IsString()
  @IsOptional()
  memo?: string;

  @ApiPropertyOptional({ description: 'Automatically approve matches', default: false })
  @IsBoolean()
  @IsOptional()
  autoApprove?: boolean;

  @ApiPropertyOptional({ description: 'Automatically create journal entry', default: false })
  @IsBoolean()
  @IsOptional()
  autoCreateJournal?: boolean;

  @ApiPropertyOptional({ description: 'Rule priority (lower = higher priority)', default: 100, minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  priority?: number;
}

export class UpdateRuleDto {
  @ApiPropertyOptional({ description: 'Rule name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Enable/disable rule' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Rule priority', minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({ description: 'Target GL account ID' })
  @IsString()
  @IsOptional()
  accountId?: string;
}
