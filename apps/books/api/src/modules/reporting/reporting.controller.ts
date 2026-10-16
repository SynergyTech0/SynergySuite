import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { ReportingService } from './reporting.service';

@ApiTags('reporting')
@ApiBearerAuth()
@Controller('organizations/:organizationId/reports')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('balance-sheet')
  @ApiOperation({ summary: 'Generate balance sheet report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: Date })
  @ApiResponse({
    status: 200,
    description: 'Balance sheet report',
  })
  async getBalanceSheet(
    @Param('organizationId') organizationId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.reportingService.generateBalanceSheet(organizationId, {
      asOfDate: asOfDate ? new Date(asOfDate) : undefined,
    });
  }

  @Get('income-statement')
  @ApiOperation({ summary: 'Generate income statement (P&L) report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'fiscalPeriodId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Income statement report',
  })
  async getIncomeStatement(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
  ) {
    return this.reportingService.generateIncomeStatement(organizationId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      fiscalPeriodId,
    });
  }

  @Get('cash-flow')
  @ApiOperation({ summary: 'Generate cash flow statement' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiResponse({
    status: 200,
    description: 'Cash flow statement',
  })
  async getCashFlowStatement(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportingService.generateCashFlowStatement(organizationId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('trial-balance')
  @ApiOperation({ summary: 'Generate trial balance report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: Date })
  @ApiQuery({ name: 'fiscalPeriodId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Trial balance report',
  })
  async getTrialBalance(
    @Param('organizationId') organizationId: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
  ) {
    return this.reportingService.generateTrialBalance(organizationId, {
      asOfDate: asOfDate ? new Date(asOfDate) : undefined,
      fiscalPeriodId,
    });
  }

  @Get('general-ledger')
  @ApiOperation({ summary: 'Generate general ledger report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'accountIds', required: false, type: [String] })
  @ApiResponse({
    status: 200,
    description: 'General ledger report',
  })
  async getGeneralLedger(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountIds') accountIds?: string | string[],
  ) {
    const accountIdArray = accountIds
      ? Array.isArray(accountIds)
        ? accountIds
        : [accountIds]
      : undefined;

    return this.reportingService.generateGeneralLedger(organizationId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      accountIds: accountIdArray,
    });
  }
}
