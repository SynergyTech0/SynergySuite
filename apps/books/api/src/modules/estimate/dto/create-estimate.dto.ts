import { IsString, IsDate, IsDecimal, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEstimateDto {
  @IsString()
  customerId: string;

  @IsString()
  subject?: string;

  @IsDate()
  @Type(() => Date)
  estimateDate: Date;

  @IsDate()
  @Type(() => Date)
  expiryDate: Date;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EstimateLineItemDto)
  lineItems: EstimateLineItemDto[];
}

export class EstimateLineItemDto {
  @IsString()
  description: string;

  @IsDecimal()
  quantity: number;

  @IsDecimal()
  unitPrice: number;
}

export class EstimateResponseDto {
  id: string;
  estimateNumber: string;
  customerId: string;
  estimateDate: Date;
  expiryDate: Date;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: any[];
}
