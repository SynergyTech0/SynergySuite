import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CalculateDepreciationDto {
  @ApiProperty({ description: 'Period date for depreciation calculation' })
  @IsDateString()
  periodDate: string;
}

export class RunMonthlyDepreciationDto {
  @ApiProperty({ description: 'Period date for monthly depreciation run' })
  @IsDateString()
  periodDate: string;
}
