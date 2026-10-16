import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsNumber,
  IsDateString,
  IsUUID,
  ValidateNested,
  ArrayMinSize,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum JournalType {
  GENERAL = 'GENERAL',
  ADJUSTING = 'ADJUSTING',
  CLOSING = 'CLOSING',
  REVERSING = 'REVERSING',
  RECURRING = 'RECURRING',
}

export enum JournalStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  POSTED = 'POSTED',
  VOIDED = 'VOIDED',
}

export enum JournalSource {
  MANUAL = 'MANUAL',
  IMPORT = 'IMPORT',
  INVOICE = 'INVOICE',
  BILL = 'BILL',
  PAYMENT = 'PAYMENT',
  RECEIPT = 'RECEIPT',
  BANK_FEED = 'BANK_FEED',
  PAYROLL = 'PAYROLL',
  DEPRECIATION = 'DEPRECIATION',
  ACCRUAL = 'ACCRUAL',
  TAX = 'TAX',
}

export class JournalLineDto {
  @ApiProperty({ description: 'Account ID' })
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({ description: 'Debit amount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @ApiPropertyOptional({ description: 'Credit amount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;

  @ApiPropertyOptional({ description: 'Line description/memo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Reference entity type' })
  @IsOptional()
  @IsString()
  referenceType?: string;

  @ApiPropertyOptional({ description: 'Reference entity ID' })
  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @ApiPropertyOptional({ description: 'Tax code override' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxCode?: string;

  @ApiPropertyOptional({ description: 'Quantity for unit-based tracking' })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ description: 'Unit price for unit-based tracking' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;
}

export class CreateJournalDto {
  @ApiProperty({ description: 'Journal entry date' })
  @IsDateString()
  date: string;

  @ApiProperty({ enum: JournalType, description: 'Type of journal entry' })
  @IsEnum(JournalType)
  type: JournalType;

  @ApiPropertyOptional({ enum: JournalSource, description: 'Source of entry' })
  @IsOptional()
  @IsEnum(JournalSource)
  source?: JournalSource;

  @ApiPropertyOptional({ description: 'Entry reference number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

  @ApiPropertyOptional({ description: 'Description/memo' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Fiscal period ID' })
  @IsOptional()
  @IsUUID()
  fiscalPeriodId?: string;

  @ApiProperty({ description: 'Journal lines', type: [JournalLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];

  @ApiPropertyOptional({ description: 'Tags for categorization' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Attachments (document IDs)' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attachments?: string[];
}

export class UpdateJournalDto {
  @ApiPropertyOptional({ description: 'Journal entry date' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Entry reference number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

  @ApiPropertyOptional({ description: 'Description/memo' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Journal lines', type: [JournalLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @Type(() => JournalLineDto)
  lines?: JournalLineDto[];

  @ApiPropertyOptional({ description: 'Tags for categorization' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class PostJournalDto {
  @ApiPropertyOptional({ description: 'Post date override' })
  @IsOptional()
  @IsDateString()
  postDate?: string;
}

export class VoidJournalDto {
  @ApiProperty({ description: 'Reason for voiding' })
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ReverseJournalDto {
  @ApiProperty({ description: 'Reversal date' })
  @IsDateString()
  reversalDate: string;

  @ApiPropertyOptional({ description: 'Reason for reversal' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class JournalSearchDto {
  @ApiPropertyOptional({ description: 'Start date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: JournalType })
  @IsOptional()
  @IsEnum(JournalType)
  type?: JournalType;

  @ApiPropertyOptional({ enum: JournalStatus })
  @IsOptional()
  @IsEnum(JournalStatus)
  status?: JournalStatus;

  @ApiPropertyOptional({ enum: JournalSource })
  @IsOptional()
  @IsEnum(JournalSource)
  source?: JournalSource;

  @ApiPropertyOptional({ description: 'Account ID to filter by' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Search in description/reference' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Fiscal period ID' })
  @IsOptional()
  @IsUUID()
  fiscalPeriodId?: string;

  @ApiPropertyOptional({ description: 'Tags to filter by' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class JournalResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  entryNumber: string;

  @ApiProperty()
  date: Date;

  @ApiProperty({ enum: JournalType })
  type: JournalType;

  @ApiProperty({ enum: JournalStatus })
  status: JournalStatus;

  @ApiPropertyOptional({ enum: JournalSource })
  source?: JournalSource;

  @ApiPropertyOptional()
  reference?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  fiscalPeriodId?: string;

  @ApiProperty()
  lines: any[];

  @ApiProperty()
  totalDebit: number;

  @ApiProperty()
  totalCredit: number;

  @ApiPropertyOptional()
  postedAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
