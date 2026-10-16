import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FORECAST_METHODS } from './budget-math';

const PERIODS = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];

export class BudgetLineItemDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiPropertyOptional({ description: 'Total for the year, spread evenly across the periods' })
  @IsOptional()
  @IsNumber()
  budgetAmount?: number;

  @ApiPropertyOptional({ description: 'One amount per period; overrides budgetAmount' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(36)
  @IsNumber({}, { each: true })
  periodAmounts?: number[];
}

export class CreateBudgetDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  budgetName: string;

  @ApiProperty()
  @IsInt()
  @Min(1900)
  @Max(2200)
  fiscalYear: number;

  @ApiProperty({ enum: PERIODS })
  @IsIn(PERIODS)
  period: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

  @ApiPropertyOptional({ description: 'Defaults to the first day of the fiscal year' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Defaults to the last day of the fiscal year' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: [BudgetLineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineItemDto)
  lineItems?: BudgetLineItemDto[];
}

export class BudgetFromActualsDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  budgetName: string;

  @ApiProperty()
  @IsInt()
  @Min(1900)
  @Max(2200)
  fiscalYear: number;

  @ApiProperty({ enum: PERIODS })
  @IsIn(PERIODS)
  period: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

  @ApiPropertyOptional({ description: 'Fiscal year whose actuals seed the plan; defaults to the year before' })
  @IsOptional()
  @IsInt()
  sourceYear?: number;

  @ApiPropertyOptional({ description: 'Percent change applied to every line, e.g. 5 for +5%' })
  @IsOptional()
  @IsNumber()
  @Min(-100)
  @Max(1000)
  growthPercent?: number;

  @ApiPropertyOptional({ description: 'Defaults to revenue and expense accounts' })
  @IsOptional()
  @IsArray()
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'], { each: true })
  accountTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationId?: string;
}

export class UpdateBudgetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  budgetName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: [BudgetLineItemDto], description: 'Replaces every line' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineItemDto)
  lineItems?: BudgetLineItemDto[];
}

export class SaveForecastDto {
  @ApiProperty({ enum: FORECAST_METHODS })
  @IsIn(FORECAST_METHODS)
  method: 'BUDGET' | 'RUN_RATE' | 'TREND';

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  asOf?: string;
}
