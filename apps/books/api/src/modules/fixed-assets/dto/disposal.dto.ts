import { IsString, IsEnum, IsNumber, IsOptional, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DisposalMethod {
  SALE = 'SALE',
  TRADE_IN = 'TRADE_IN',
  SCRAP = 'SCRAP',
  DONATION = 'DONATION',
  THEFT = 'THEFT',
  CASUALTY = 'CASUALTY',
  OTHER = 'OTHER',
}

export class DisposeAssetDto {
  @ApiProperty({ description: 'Date of disposal' })
  @IsDateString()
  disposalDate: string;

  @ApiProperty({ enum: DisposalMethod, description: 'Method of disposal' })
  @IsEnum(DisposalMethod)
  disposalMethod: DisposalMethod;

  @ApiPropertyOptional({ description: 'Sale price received', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  salePrice?: number;

  @ApiPropertyOptional({ description: 'Expenses incurred in sale', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  saleExpenses?: number;

  @ApiPropertyOptional({ description: 'Name of buyer (if sold)' })
  @IsString()
  @IsOptional()
  buyerName?: string;

  @ApiPropertyOptional({ description: 'Additional notes about disposal' })
  @IsString()
  @IsOptional()
  notes?: string;
}
