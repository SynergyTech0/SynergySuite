import { IsString, IsEnum, IsNumber, IsOptional, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AssetType {
  BUILDING = 'BUILDING',
  EQUIPMENT = 'EQUIPMENT',
  VEHICLE = 'VEHICLE',
  COMPUTER_EQUIPMENT = 'COMPUTER_EQUIPMENT',
  FURNITURE = 'FURNITURE',
  SOFTWARE = 'SOFTWARE',
  LAND = 'LAND',
  LEASEHOLD_IMPROVEMENT = 'LEASEHOLD_IMPROVEMENT',
  OTHER = 'OTHER',
}

export enum DepreciationMethod {
  STRAIGHT_LINE = 'STRAIGHT_LINE',
  DECLINING_BALANCE = 'DECLINING_BALANCE',
  DOUBLE_DECLINING = 'DOUBLE_DECLINING',
  MACRS_GDS = 'MACRS_GDS',
  MACRS_ADS = 'MACRS_ADS',
  SECTION_179 = 'SECTION_179',
  NO_DEPRECIATION = 'NO_DEPRECIATION',
}

export class CreateAssetDto {
  @ApiProperty({ description: 'Unique asset number' })
  @IsString()
  assetNumber: string;

  @ApiProperty({ description: 'Asset name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Asset description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: AssetType, description: 'Type of asset' })
  @IsEnum(AssetType)
  assetType: AssetType;

  @ApiProperty({ description: 'Date asset was acquired' })
  @IsDateString()
  acquisitionDate: string;

  @ApiProperty({ description: 'Cost of acquisition', minimum: 0 })
  @IsNumber()
  @Min(0)
  acquisitionCost: number;

  @ApiPropertyOptional({ description: 'Method of acquisition (purchase, lease, etc.)' })
  @IsString()
  @IsOptional()
  acquisitionMethod?: string;

  @ApiPropertyOptional({ description: 'Vendor ID' })
  @IsString()
  @IsOptional()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'Physical location of asset' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ description: 'Department using the asset' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ description: 'Serial number' })
  @IsString()
  @IsOptional()
  serialNumber?: string;

  @ApiPropertyOptional({ description: 'Salvage value at end of useful life', minimum: 0, default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  salvageValue?: number;

  @ApiProperty({ description: 'Useful life in months', minimum: 1 })
  @IsNumber()
  @Min(1)
  usefulLifeMonths: number;

  @ApiProperty({ enum: DepreciationMethod, description: 'Method of depreciation' })
  @IsEnum(DepreciationMethod)
  depreciationMethod: DepreciationMethod;

  @ApiPropertyOptional({ description: 'MACRS class (3, 5, 7, 10, 15, 20, 27.5, 39 years)' })
  @IsString()
  @IsOptional()
  macrsClass?: string;

  @ApiPropertyOptional({ description: 'Section 179 deduction amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  section179Amount?: number;

  @ApiProperty({ description: 'Asset account ID in chart of accounts' })
  @IsString()
  assetAccountId: string;

  @ApiProperty({ description: 'Accumulated depreciation account ID' })
  @IsString()
  accumulatedDepAccountId: string;

  @ApiProperty({ description: 'Depreciation expense account ID' })
  @IsString()
  depreciationExpenseAccountId: string;

  @ApiPropertyOptional({ description: 'Gain/loss on disposal account ID' })
  @IsString()
  @IsOptional()
  gainLossAccountId?: string;
}

export class UpdateAssetDto {
  @ApiPropertyOptional({ description: 'Asset name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Asset description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Physical location of asset' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ description: 'Department using the asset' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ description: 'Serial number' })
  @IsString()
  @IsOptional()
  serialNumber?: string;
}
