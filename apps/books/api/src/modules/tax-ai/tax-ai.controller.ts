import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import { TaxAiService } from './tax-ai.service';

class AskDto {
  @IsString() question: string;
}
class AnalyzeDto {
  @IsString() description: string;
  @IsNumber() @IsOptional() amount?: number;
  @IsString() @IsOptional() category?: string;
}

@Controller('organizations/:organizationId/tax-ai')
@UseGuards(SuiteAuthGuard)
export class TaxAiController {
  constructor(private readonly service: TaxAiService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  @Post('ask')
  ask(@Body() dto: AskDto) {
    return this.service.ask(dto.question);
  }

  @Post('analyze')
  analyze(@Body() dto: AnalyzeDto) {
    return this.service.analyze(dto.description, dto.amount, dto.category);
  }
}
