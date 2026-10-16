import { IsString, IsEnum, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MatchMethod {
  EXACT_MATCH = 'EXACT_MATCH',
  FUZZY_MATCH = 'FUZZY_MATCH',
  RULE_BASED = 'RULE_BASED',
  MANUAL = 'MANUAL',
}

export class MatchTransactionDto {
  @ApiProperty({ description: 'Journal entry ID to match' })
  @IsString()
  journalId: string;

  @ApiProperty({ enum: MatchMethod, description: 'Match method used' })
  @IsEnum(MatchMethod)
  matchMethod: MatchMethod;

  @ApiPropertyOptional({ description: 'Match confidence score (0-100)', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  confidence?: number;
}

export class CategorizeTransactionDto {
  @ApiProperty({ description: 'GL account ID for categorization' })
  @IsString()
  accountId: string;

  @ApiPropertyOptional({ description: 'Vendor ID if applicable' })
  @IsString()
  @IsOptional()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'Customer ID if applicable' })
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Memo/notes' })
  @IsString()
  @IsOptional()
  memo?: string;

  @ApiPropertyOptional({ description: 'Create journal entry automatically', default: true })
  @IsOptional()
  createJournal?: boolean;
}
