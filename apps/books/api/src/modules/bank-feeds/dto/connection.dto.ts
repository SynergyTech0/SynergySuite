import { IsString, IsEnum, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum BankFeedProvider {
  PLAID = 'PLAID',
  YODLEE = 'YODLEE',
  MANUAL = 'MANUAL',
}

export class CreateConnectionDto {
  @ApiProperty({ description: 'Bank account ID to connect' })
  @IsString()
  bankAccountId: string;

  @ApiProperty({ enum: BankFeedProvider, description: 'Bank feed provider' })
  @IsEnum(BankFeedProvider)
  provider: BankFeedProvider;

  @ApiPropertyOptional({ description: 'Plaid public token (for Plaid connections)' })
  @IsString()
  @IsOptional()
  publicToken?: string;

  @ApiPropertyOptional({ description: 'Plaid item ID' })
  @IsString()
  @IsOptional()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Plaid access token' })
  @IsString()
  @IsOptional()
  accessToken?: string;

  @ApiPropertyOptional({ description: 'Plaid account ID' })
  @IsString()
  @IsOptional()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Yodlee provider account ID' })
  @IsString()
  @IsOptional()
  yodleeProviderAccountId?: string;

  @ApiPropertyOptional({ description: 'Yodlee account ID' })
  @IsString()
  @IsOptional()
  yodleeAccountId?: string;

  @ApiPropertyOptional({ description: 'Enable automatic sync', default: true })
  @IsBoolean()
  @IsOptional()
  autoSync?: boolean;

  @ApiPropertyOptional({ description: 'Sync frequency in hours', default: 24, minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  syncFrequencyHours?: number;

  @ApiPropertyOptional({ description: 'Days of history to sync', default: 90, minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  syncHistoryDays?: number;
}

export class UpdateConnectionDto {
  @ApiPropertyOptional({ description: 'Enable/disable automatic sync' })
  @IsBoolean()
  @IsOptional()
  autoSync?: boolean;

  @ApiPropertyOptional({ description: 'Sync frequency in hours', minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  syncFrequencyHours?: number;

  @ApiPropertyOptional({ description: 'Days of history to sync', minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  syncHistoryDays?: number;
}

export class ExchangePlaidTokenDto {
  @ApiProperty({ description: 'Plaid public token from Link' })
  @IsString()
  publicToken: string;

  @ApiProperty({ description: 'Bank account ID to connect' })
  @IsString()
  bankAccountId: string;

  @ApiPropertyOptional({ description: 'Plaid account ID to link' })
  @IsString()
  @IsOptional()
  accountId?: string;
}
