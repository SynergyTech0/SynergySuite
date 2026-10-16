import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TaxCalculationLineItemDto {
  @ApiProperty({ description: 'Line item amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ description: 'Whether this item is taxable', default: true })
  @IsBoolean()
  @IsOptional()
  isTaxable?: boolean;

  @ApiPropertyOptional({ description: 'Product category for taxability lookup' })
  @IsString()
  @IsOptional()
  productCategory?: string;

  @ApiPropertyOptional({ description: 'Inventory item ID for taxability lookup' })
  @IsString()
  @IsOptional()
  inventoryItemId?: string;
}

export class TaxCalculationAddressDto {
  @ApiPropertyOptional({ description: 'State code (e.g., CA)' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'City name' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ description: 'County name' })
  @IsString()
  @IsOptional()
  county?: string;

  @ApiPropertyOptional({ description: 'ZIP code' })
  @IsString()
  @IsOptional()
  zipCode?: string;
}

export class CalculateTaxDto {
  @ApiProperty({ description: 'Line items to calculate tax for', type: [TaxCalculationLineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxCalculationLineItemDto)
  lineItems: TaxCalculationLineItemDto[];

  @ApiProperty({ description: 'Ship to address for tax calculation', type: TaxCalculationAddressDto })
  @ValidateNested()
  @Type(() => TaxCalculationAddressDto)
  shipToAddress: TaxCalculationAddressDto;

  @ApiPropertyOptional({ description: 'Customer ID for exemption check' })
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Transaction date (defaults to current date)' })
  @IsDateString()
  @IsOptional()
  transactionDate?: string;
}
