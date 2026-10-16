import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsUUID,
  IsBoolean,
  MaxLength,
  Min,
} from 'class-validator';

export enum BankAccountType {
  CHECKING = 'CHECKING',
  SAVINGS = 'SAVINGS',
  CREDIT_CARD = 'CREDIT_CARD',
  MONEY_MARKET = 'MONEY_MARKET',
  LINE_OF_CREDIT = 'LINE_OF_CREDIT',
}

export enum TransactionType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  CLEARED = 'CLEARED',
  RECONCILED = 'RECONCILED',
  EXCLUDED = 'EXCLUDED',
}

export enum ReconciliationStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
}

export class CreateBankAccountDto {
  @ApiProperty({ description: 'Account name' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ enum: BankAccountType })
  @IsEnum(BankAccountType)
  accountType: BankAccountType;

  @ApiPropertyOptional({ description: 'Bank name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankName?: string;

  @ApiPropertyOptional({ description: 'Last 4 digits of account number' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  accountNumberLast4?: string;

  @ApiPropertyOptional({ description: 'Routing number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  routingNumber?: string;

  @ApiProperty({ description: 'GL account ID to link' })
  @IsUUID()
  glAccountId: string;

  @ApiPropertyOptional({ description: 'Opening balance' })
  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @ApiPropertyOptional({ description: 'Opening balance date' })
  @IsOptional()
  @IsDateString()
  openingBalanceDate?: string;

  @ApiPropertyOptional({ description: 'Currency code' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class UpdateBankAccountDto {
  @ApiPropertyOptional({ description: 'Account name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Bank name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankName?: string;

  @ApiPropertyOptional({ description: 'Is account active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBankTransactionDto {
  @ApiProperty({ description: 'Bank account ID' })
  @IsUUID()
  bankAccountId: string;

  @ApiProperty({ description: 'Transaction date' })
  @IsDateString()
  transactionDate: string;

  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ description: 'Amount (positive)' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Description/Payee' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Reference/Check number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

  @ApiPropertyOptional({ description: 'Category account ID' })
  @IsOptional()
  @IsUUID()
  categoryAccountId?: string;

  @ApiPropertyOptional({ description: 'Vendor ID' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'Customer ID' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class MatchTransactionDto {
  @ApiProperty({ description: 'Journal entry ID to match' })
  @IsUUID()
  journalEntryId: string;
}

export class CategorizeTransactionDto {
  @ApiProperty({ description: 'Expense/Income account ID' })
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({ description: 'Description override' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Vendor ID' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'Customer ID' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Create as rule for future transactions' })
  @IsOptional()
  @IsBoolean()
  createRule?: boolean;
}

export class StartReconciliationDto {
  @ApiProperty({ description: 'Bank account ID' })
  @IsUUID()
  bankAccountId: string;

  @ApiProperty({ description: 'Statement date' })
  @IsDateString()
  statementDate: string;

  @ApiProperty({ description: 'Statement ending balance' })
  @IsNumber()
  statementEndingBalance: number;
}

export class ReconcileTransactionsDto {
  @ApiProperty({ description: 'Transaction IDs to mark as reconciled' })
  @IsUUID('4', { each: true })
  transactionIds: string[];
}
