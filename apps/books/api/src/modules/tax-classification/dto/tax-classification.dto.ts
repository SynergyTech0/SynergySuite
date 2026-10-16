import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsArray,
  IsEnum,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ClassificationCategory {
  // Income categories
  ORDINARY_INCOME = 'ORDINARY_INCOME',
  CAPITAL_GAIN_SHORT = 'CAPITAL_GAIN_SHORT',
  CAPITAL_GAIN_LONG = 'CAPITAL_GAIN_LONG',
  DIVIDEND_QUALIFIED = 'DIVIDEND_QUALIFIED',
  DIVIDEND_ORDINARY = 'DIVIDEND_ORDINARY',
  INTEREST_TAXABLE = 'INTEREST_TAXABLE',
  INTEREST_TAX_EXEMPT = 'INTEREST_TAX_EXEMPT',
  RENTAL_INCOME = 'RENTAL_INCOME',
  ROYALTY_INCOME = 'ROYALTY_INCOME',
  PARTNERSHIP_INCOME = 'PARTNERSHIP_INCOME',
  S_CORP_INCOME = 'S_CORP_INCOME',

  // Expense categories
  COGS = 'COGS',
  BUSINESS_EXPENSE_ORDINARY = 'BUSINESS_EXPENSE_ORDINARY',
  BUSINESS_EXPENSE_NECESSARY = 'BUSINESS_EXPENSE_NECESSARY',
  DEPRECIATION_EXPENSE = 'DEPRECIATION_EXPENSE',
  AMORTIZATION_EXPENSE = 'AMORTIZATION_EXPENSE',
  INTEREST_EXPENSE_BUSINESS = 'INTEREST_EXPENSE_BUSINESS',
  INTEREST_EXPENSE_INVESTMENT = 'INTEREST_EXPENSE_INVESTMENT',
  CHARITABLE_CONTRIBUTION = 'CHARITABLE_CONTRIBUTION',
  MEALS_ENTERTAINMENT = 'MEALS_ENTERTAINMENT',
  TRAVEL_EXPENSE = 'TRAVEL_EXPENSE',
  HOME_OFFICE = 'HOME_OFFICE',
  VEHICLE_EXPENSE = 'VEHICLE_EXPENSE',
  EMPLOYEE_BENEFIT = 'EMPLOYEE_BENEFIT',
  RETIREMENT_CONTRIBUTION = 'RETIREMENT_CONTRIBUTION',
  HEALTH_INSURANCE = 'HEALTH_INSURANCE',
  PAYROLL_TAX = 'PAYROLL_TAX',

  // Special categories
  NON_DEDUCTIBLE = 'NON_DEDUCTIBLE',
  CAPITAL_EXPENDITURE = 'CAPITAL_EXPENDITURE',
  PERSONAL_EXPENSE = 'PERSONAL_EXPENSE',
  RELATED_PARTY = 'RELATED_PARTY',
  SECTION_179 = 'SECTION_179',
  BONUS_DEPRECIATION = 'BONUS_DEPRECIATION',

  // Liability categories
  SALES_TAX_LIABILITY = 'SALES_TAX_LIABILITY',
  PAYROLL_TAX_LIABILITY = 'PAYROLL_TAX_LIABILITY',
  INCOME_TAX_LIABILITY = 'INCOME_TAX_LIABILITY',

  // Unknown
  UNCLASSIFIED = 'UNCLASSIFIED',
}

export enum DeductibilityStatus {
  FULLY_DEDUCTIBLE = 'FULLY_DEDUCTIBLE',
  PARTIALLY_DEDUCTIBLE = 'PARTIALLY_DEDUCTIBLE',
  NON_DEDUCTIBLE = 'NON_DEDUCTIBLE',
  CAPITALIZED = 'CAPITALIZED',
  DEFERRED = 'DEFERRED',
}

export class TaxCitationDto {
  @ApiProperty({ description: 'IRC section reference' })
  @IsString()
  section: string;

  @ApiPropertyOptional({ description: 'Treasury regulation reference' })
  @IsOptional()
  @IsString()
  regulation?: string;

  @ApiPropertyOptional({ description: 'IRS publication reference' })
  @IsOptional()
  @IsString()
  publication?: string;

  @ApiPropertyOptional({ description: 'Relevant court case' })
  @IsOptional()
  @IsString()
  courtCase?: string;

  @ApiPropertyOptional({ description: 'Citation text/summary' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiProperty({ description: 'Relevance score (0-1)' })
  @IsNumber()
  @Min(0)
  @Max(1)
  relevanceScore: number;
}

export class ClassifyTransactionDto {
  @ApiProperty({ description: 'Transaction description' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'Transaction amount' })
  @IsNumber()
  amount: number;

  @ApiProperty({ description: 'Account ID' })
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({ description: 'Vendor/payee name' })
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiPropertyOptional({ description: 'Transaction category hint' })
  @IsOptional()
  @IsString()
  categoryHint?: string;

  @ApiPropertyOptional({ description: 'Additional context' })
  @IsOptional()
  @IsString()
  context?: string;
}

export class ClassifyJournalLineDto {
  @ApiProperty({ description: 'Journal line ID' })
  @IsUUID()
  journalLineId: string;
}

export class BatchClassifyDto {
  @ApiProperty({ description: 'Items to classify', type: [ClassifyTransactionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClassifyTransactionDto)
  items: ClassifyTransactionDto[];
}

export class ClassificationResultDto {
  @ApiProperty({ enum: ClassificationCategory })
  category: ClassificationCategory;

  @ApiProperty({ description: 'Confidence score (0-1)' })
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @ApiProperty({ enum: DeductibilityStatus })
  deductibility: DeductibilityStatus;

  @ApiPropertyOptional({ description: 'Deductible percentage if partially deductible' })
  deductiblePercentage?: number;

  @ApiProperty({ description: 'Tax citations supporting this classification', type: [TaxCitationDto] })
  citations: TaxCitationDto[];

  @ApiPropertyOptional({ description: 'Explanation of classification' })
  explanation?: string;

  @ApiPropertyOptional({ description: 'Alternative classifications considered' })
  alternatives?: Array<{
    category: ClassificationCategory;
    confidence: number;
    reason: string;
  }>;

  @ApiPropertyOptional({ description: 'Warnings or notes' })
  warnings?: string[];

  @ApiPropertyOptional({ description: 'Form/schedule placement' })
  formPlacement?: {
    form: string;
    line?: string;
    schedule?: string;
    instructions?: string;
  };
}

export class ClassificationFeedbackDto {
  @ApiProperty({ description: 'Classification ID' })
  @IsUUID()
  classificationId: string;

  @ApiProperty({ description: 'Was the classification correct?' })
  isCorrect: boolean;

  @ApiPropertyOptional({ description: 'Correct category if different', enum: ClassificationCategory })
  @IsOptional()
  @IsEnum(ClassificationCategory)
  correctCategory?: ClassificationCategory;

  @ApiPropertyOptional({ description: 'Feedback notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ClassificationQueryDto {
  @ApiPropertyOptional({ description: 'Tax question or scenario' })
  @IsOptional()
  @IsString()
  question?: string;

  @ApiPropertyOptional({ description: 'Entity type context' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ description: 'Industry context' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ description: 'Tax year' })
  @IsOptional()
  @IsNumber()
  taxYear?: number;
}
