import { IsString, IsNumber, IsOptional, IsEnum, IsDate, IsArray, IsBoolean, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PayFrequency {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  SEMIMONTHLY = 'SEMIMONTHLY',
  MONTHLY = 'MONTHLY',
}

export class SetupPayrollDto {
  @ApiProperty({ enum: PayFrequency })
  @IsEnum(PayFrequency)
  payFrequency: PayFrequency;

  @ApiPropertyOptional({ default: 5, description: '1=Monday, 7=Sunday' })
  @IsOptional()
  @IsNumber()
  defaultPayDay?: number = 5;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  federalEIN?: string;

  @ApiPropertyOptional({ description: 'State EINs as JSON object' })
  @IsOptional()
  stateEINs?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  federalDepositSchedule?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payrollBankAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  directDepositEnabled?: boolean = false;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @IsNumber()
  overtimeThreshold?: number = 40;

  @ApiPropertyOptional({ default: 1.5 })
  @IsOptional()
  @IsNumber()
  overtimeMultiplier?: number = 1.5;
}

export class EmployeeHoursDto {
  @ApiProperty()
  @IsString()
  employeeId: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  regularHours?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHours?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ptoHours?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  holidayHours?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sickHours?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bonusPay?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionPay?: number = 0;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memo?: string;
}

export class CreatePayrollRunDto {
  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodStart: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodEnd: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  payDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeeHoursDto)
  employeeHours?: EmployeeHoursDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePaycheckDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  regularHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  bonusPay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memo?: string;
}

export class EmployeeDeductionSetupDto {
  @ApiProperty()
  @IsString()
  employeeId: string;

  @ApiProperty()
  @IsString()
  type: string; // FEDERAL_TAX, STATE_TAX, 401K, HEALTH_INSURANCE, etc.

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  percentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPercentage?: boolean = false;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPreTax?: boolean = true;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasEmployerMatch?: boolean = false;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  employerMatchPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  employerMatchLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  annualLimit?: number;
}

export class GenerateW2Dto {
  @ApiProperty()
  @IsNumber()
  taxYear: number;

  @ApiPropertyOptional({ description: 'Generate for specific employee, or all if not provided' })
  @IsOptional()
  @IsString()
  employeeId?: string;
}
