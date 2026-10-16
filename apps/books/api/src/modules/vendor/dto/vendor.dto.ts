import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEmail,
  IsBoolean,
  IsNumber,
  IsObject,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateVendorDto {
  @ApiProperty({ description: 'Vendor name' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Vendor email' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Vendor phone' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Company name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @ApiPropertyOptional({ description: 'Tax ID / EIN' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @ApiPropertyOptional({ description: 'Address' })
  @IsOptional()
  @IsObject()
  address?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Payment terms (days)' })
  @IsOptional()
  @IsNumber()
  paymentTerms?: number;

  @ApiPropertyOptional({ description: 'Default expense account ID' })
  @IsOptional()
  @IsString()
  defaultExpenseAccountId?: string;

  @ApiPropertyOptional({ description: 'Is 1099 vendor' })
  @IsOptional()
  @IsBoolean()
  is1099?: boolean;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateVendorDto {
  @ApiPropertyOptional({ description: 'Vendor name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Vendor email' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Vendor phone' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Tax ID / EIN' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @ApiPropertyOptional({ description: 'Address' })
  @IsOptional()
  @IsObject()
  address?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Payment terms (days)' })
  @IsOptional()
  @IsNumber()
  paymentTerms?: number;

  @ApiPropertyOptional({ description: 'Default expense account ID' })
  @IsOptional()
  @IsString()
  defaultExpenseAccountId?: string;

  @ApiPropertyOptional({ description: 'Is 1099 vendor' })
  @IsOptional()
  @IsBoolean()
  is1099?: boolean;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Is vendor active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
