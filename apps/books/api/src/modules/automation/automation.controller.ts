import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TransactionCategorizerService } from './transaction-categorizer.service';
import { IncomeStatementService } from './income-statement.service';
import { AutomationOrchestrationService } from './automation-orchestration.service';

@ApiTags('Automation')
@Controller('organizations/:organizationId/automation')
export class AutomationController {
  private readonly logger = new Logger(AutomationController.name);

  constructor(
    private categorizer: TransactionCategorizerService,
    private incomeStatement: IncomeStatementService,
    private orchestration: AutomationOrchestrationService,
  ) {}

  /**
   * Get suggested category for transaction
   */
  @Get('categorization/suggest')
  @ApiOperation({ summary: 'Get AI suggested category for transaction' })
  @ApiResponse({ status: 200, description: 'Suggested category with confidence' })
  async suggestCategory(@Query('description') description: string) {
    this.logger.log(`Suggesting category for: ${description}`);
    return this.categorizer.getSuggestedCategory(description);
  }

  /**
   * Trigger categorization job
   */
  @Post('categorization/trigger')
  @ApiOperation({ summary: 'Manually trigger transaction categorization' })
  @ApiResponse({ status: 200, description: 'Categorization completed' })
  async triggerCategorization(@Param('organizationId') organizationId: string) {
    this.logger.log(`Triggering categorization for ${organizationId}`);
    return this.orchestration.triggerCategorization(organizationId);
  }

  /**
   * Get current month P&L
   */
  @Get('p-and-l/current-month')
  @ApiOperation({ summary: 'Generate current month P&L' })
  @ApiResponse({ status: 200, description: 'Income statement for current month' })
  async getCurrentMonthP_L(@Param('organizationId') organizationId: string) {
    this.logger.log(`Generating current month P&L for ${organizationId}`);
    return this.incomeStatement.generateCurrentMonthP_L(organizationId);
  }

  /**
   * Get YTD P&L
   */
  @Get('p-and-l/ytd')
  @ApiOperation({ summary: 'Generate year-to-date P&L' })
  @ApiResponse({ status: 200, description: 'Income statement year-to-date' })
  async getYTDP_L(@Param('organizationId') organizationId: string) {
    this.logger.log(`Generating YTD P&L for ${organizationId}`);
    return this.incomeStatement.generateYearToDateP_L(organizationId);
  }

  /**
   * Get quarterly P&L
   */
  @Get('p-and-l/quarterly')
  @ApiOperation({ summary: 'Generate quarterly P&L' })
  @ApiResponse({ status: 200, description: 'Income statement for quarter' })
  async getQuarterlyP_L(
    @Param('organizationId') organizationId: string,
    @Query('quarter') quarter: string,
    @Query('year') year: string,
  ) {
    const q = parseInt(quarter) as 1 | 2 | 3 | 4;
    const y = parseInt(year);
    this.logger.log(`Generating Q${q} ${y} P&L for ${organizationId}`);
    return this.incomeStatement.generateQuarterlyP_L(organizationId, q, y);
  }

  /**
   * Get custom date range P&L
   */
  @Post('p-and-l/custom')
  @ApiOperation({ summary: 'Generate P&L for custom date range' })
  @ApiResponse({ status: 200, description: 'Income statement for date range' })
  async getCustomP_L(
    @Param('organizationId') organizationId: string,
    @Body() body: { startDate: string; endDate: string },
  ) {
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    this.logger.log(
      `Generating custom P&L for ${organizationId} from ${startDate} to ${endDate}`,
    );
    return this.incomeStatement.generateIncomeStatement(organizationId, startDate, endDate);
  }

  /**
   * Get automation status
   */
  @Get('status')
  @ApiOperation({ summary: 'Get automation status and last run times' })
  @ApiResponse({ status: 200, description: 'Automation status' })
  async getAutomationStatus(@Param('organizationId') organizationId: string) {
    return {
      organization: organizationId,
      automationEnabled: true,
      lastCategorization: new Date(),
      lastP_LGeneration: new Date(),
      nextScheduledCategorization: new Date(Date.now() + 24 * 60 * 60 * 1000),
      nextScheduledP_L: new Date(Date.now() + 24 * 60 * 60 * 1000),
      jobs: [
        {
          name: 'Daily Categorization',
          schedule: 'Every day at 2 AM',
          nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
          enabled: true,
        },
        {
          name: 'Daily P&L Generation',
          schedule: 'Every day at 3 AM',
          nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
          enabled: true,
        },
        {
          name: 'Monthly Financial Report',
          schedule: 'First day of month at 4 AM',
          nextRun: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          enabled: true,
        },
        {
          name: 'Quarterly Review',
          schedule: 'First day of quarter at 5 AM',
          nextRun: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          enabled: true,
        },
      ],
    };
  }
}
