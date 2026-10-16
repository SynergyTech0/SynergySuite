import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

export enum AccountSubType {
  // Assets
  CURRENT_ASSET = 'CURRENT_ASSET',
  FIXED_ASSET = 'FIXED_ASSET',
  OTHER_ASSET = 'OTHER_ASSET',
  // Liabilities
  CURRENT_LIABILITY = 'CURRENT_LIABILITY',
  LONG_TERM_LIABILITY = 'LONG_TERM_LIABILITY',
  // Equity
  EQUITY = 'EQUITY',
  RETAINED_EARNINGS = 'RETAINED_EARNINGS',
  // Revenue
  OPERATING_REVENUE = 'OPERATING_REVENUE',
  OTHER_INCOME = 'OTHER_INCOME',
  // Expenses
  COST_OF_GOODS_SOLD = 'COST_OF_GOODS_SOLD',
  OPERATING_EXPENSE = 'OPERATING_EXPENSE',
  OTHER_EXPENSE = 'OTHER_EXPENSE',
}

export enum NormalBalance {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export class CreateAccountDto {
  @ApiProperty({ description: 'Account code (unique within organization)' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'Account code must be alphanumeric' })
  code: string;

  @ApiProperty({ description: 'Account name' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Account description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: AccountType, description: 'Account type' })
  @IsEnum(AccountType)
  type: AccountType;

  @ApiProperty({ enum: AccountSubType, description: 'Account sub-type' })
  @IsEnum(AccountSubType)
  subType: AccountSubType;

  @ApiProperty({ enum: NormalBalance, description: 'Normal balance side' })
  @IsEnum(NormalBalance)
  normalBalance: NormalBalance;

  @ApiPropertyOptional({ description: 'Parent account ID' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Tax code for default tax classification' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxCode?: string;

  @ApiPropertyOptional({ description: 'Is this a bank account' })
  @IsOptional()
  @IsBoolean()
  isBankAccount?: boolean;

  @ApiPropertyOptional({ description: 'Currency code for this account' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class UpdateAccountDto {
  @ApiPropertyOptional({ description: 'Account name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Account description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: AccountSubType, description: 'Account sub-type' })
  @IsOptional()
  @IsEnum(AccountSubType)
  subType?: AccountSubType;

  @ApiPropertyOptional({ description: 'Parent account ID' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Tax code for default tax classification' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxCode?: string;

  @ApiPropertyOptional({ description: 'Is this a bank account' })
  @IsOptional()
  @IsBoolean()
  isBankAccount?: boolean;

  @ApiPropertyOptional({ description: 'Is account active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AccountBalanceDto {
  @ApiProperty()
  accountId: string;

  @ApiProperty()
  accountCode: string;

  @ApiProperty()
  accountName: string;

  @ApiProperty()
  debitBalance: number;

  @ApiProperty()
  creditBalance: number;

  @ApiProperty()
  balance: number;

  @ApiProperty()
  normalBalance: NormalBalance;
}

export class AccountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ enum: AccountType })
  type: AccountType;

  @ApiProperty({ enum: AccountSubType })
  subType: AccountSubType;

  @ApiProperty({ enum: NormalBalance })
  normalBalance: NormalBalance;

  @ApiPropertyOptional()
  parentId?: string;

  @ApiPropertyOptional()
  taxCode?: string;

  @ApiProperty()
  isBankAccount: boolean;

  @ApiProperty()
  isSystemAccount: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
