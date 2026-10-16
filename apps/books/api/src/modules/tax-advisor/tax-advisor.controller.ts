import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TaxAdvisorService } from './tax-advisor.service';

@ApiTags('tax-advisor')
@ApiBearerAuth()
@Controller('organizations/:organizationId/tax-advisor')
export class TaxAdvisorController {
  constructor(private readonly taxAdvisorService: TaxAdvisorService) {}

  @Get('analyze-opportunities')
  @ApiOperation({ summary: 'Analyze tax optimization opportunities' })
  async analyzeTaxOpportunities(
    @Param('organizationId') organizationId: string,
    @Query('year') year: string,
    @Query('state') state?: string,
  ) {
    return this.taxAdvisorService.analyzeTaxOpportunities(organizationId, parseInt(year), state);
  }

  @Get('compliance')
  @ApiOperation({ summary: 'Get tax compliance requirements' })
  async getTaxCompliance(
    @Param('organizationId') organizationId: string,
    @Query('year') year: string,
  ) {
    return this.taxAdvisorService.getTaxCompliance(organizationId, parseInt(year));
  }

  @Post('ask-question')
  @ApiOperation({ summary: 'Ask a tax question to AI advisor' })
  async askQuestion(
    @Param('organizationId') organizationId: string,
    @Body() body: { question: string },
  ) {
    return this.taxAdvisorService.askTaxQuestion(organizationId, body.question);
  }
}
