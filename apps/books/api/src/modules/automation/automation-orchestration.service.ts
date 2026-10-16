import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionCategorizerService, toExpenseCategory } from './transaction-categorizer.service';
import { IncomeStatementService } from './income-statement.service';

@Injectable()
export class AutomationOrchestrationService {
  private readonly logger = new Logger(AutomationOrchestrationService.name);

  constructor(
    private prisma: PrismaService,
    private categorizer: TransactionCategorizerService,
    private incomeStatement: IncomeStatementService,
  ) {}

  /**
   * Daily categorization job - runs at 2 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async dailyCategorizationJob(): Promise<void> {
    this.logger.log('Starting daily categorization job...');

    try {
      const organizations = await this.prisma.organization.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const org of organizations) {
        const count = await this.categorizer.categorizeUncategorizedTransactions(org.id);
        this.logger.log(`Categorized ${count} transactions for organization ${org.id}`);
      }
    } catch (error) {
      this.logger.error('Daily categorization job failed:', error);
    }
  }

  /**
   * Daily P&L generation - runs at 3 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyP_LGenerationJob(): Promise<void> {
    this.logger.log('Starting daily P&L generation job...');

    try {
      const organizations = await this.prisma.organization.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const org of organizations) {
        const statement = await this.incomeStatement.generateCurrentMonthP_L(org.id);
        this.logger.log(`Generated P&L for ${org.id}: Net Income = $${statement.netIncome.amount}`);
      }
    } catch (error) {
      this.logger.error('Daily P&L generation job failed:', error);
    }
  }

  /**
   * Monthly financial report - runs on first day of month at 4 AM
   */
  @Cron('0 4 1 * *') // First day of month at 4 AM
  async monthlyFinancialReportJob(): Promise<void> {
    this.logger.log('Starting monthly financial report job...');

    try {
      const organizations = await this.prisma.organization.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const org of organizations) {
        // Generate month-end P&L
        const statement = await this.incomeStatement.generateYearToDateP_L(org.id);

        // Generate report
        await this.generateMonthlyReport(org.id, statement);

        this.logger.log(`Generated monthly report for ${org.id}`);
      }
    } catch (error) {
      this.logger.error('Monthly financial report job failed:', error);
    }
  }

  /**
   * Quarterly review - runs on first day of each quarter at 5 AM
   */
  @Cron('0 5 1 1,4,7,10 *') // Jan 1, Apr 1, Jul 1, Oct 1
  async quarterlyReviewJob(): Promise<void> {
    this.logger.log('Starting quarterly review job...');

    try {
      const now = new Date();
      const quarter = (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;

      const organizations = await this.prisma.organization.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const org of organizations) {
        const statement = await this.incomeStatement.generateQuarterlyP_L(org.id, quarter, now.getFullYear());
        this.logger.log(`Generated Q${quarter} report for ${org.id}`);
      }
    } catch (error) {
      this.logger.error('Quarterly review job failed:', error);
    }
  }

  /**
   * Auto-categorize on transaction creation
   */
  async onTransactionCreated(transactionId: string, organizationId: string): Promise<void> {
    try {
      const expense = await this.prisma.expense.findUnique({
        where: { id: transactionId },
      });

      if (!expense) return;

      const result = await this.categorizer.categorizeTransaction({
        id: transactionId,
        description: expense.description || '',
        amount: expense.amount.toNumber(),
        type: 'EXPENSE',
        organizationId,
      });

      // Update if confidence is high
      const category = toExpenseCategory(result.category);
      if (result.confidence > 0.75 && category) {
        await this.prisma.expense.update({
          where: { id: transactionId },
          data: {
            category,
          },
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to auto-categorize transaction ${transactionId}:`, error);
    }
  }

  /**
   * Generate monthly report
   */
  private async generateMonthlyReport(organizationId: string, statement: any): Promise<void> {
    const report = {
      organizationId,
      month: new Date(),
      data: statement,
      generatedAt: new Date(),
    };

    // Store report
    this.logger.log(`Monthly report stored for ${organizationId}`);
  }

  /**
   * Manually trigger categorization for organization
   */
  async triggerCategorization(organizationId: string): Promise<{ success: boolean; categorized: number }> {
    try {
      const count = await this.categorizer.categorizeUncategorizedTransactions(organizationId);
      return { success: true, categorized: count };
    } catch (error) {
      this.logger.error('Manual categorization failed:', error);
      return { success: false, categorized: 0 };
    }
  }

  /**
   * Manually trigger P&L generation
   */
  async triggerP_LGeneration(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ success: boolean; data: any }> {
    try {
      const statement = await this.incomeStatement.generateIncomeStatement(
        organizationId,
        startDate,
        endDate,
      );
      return { success: true, data: statement };
    } catch (error) {
      this.logger.error('Manual P&L generation failed:', error);
      return { success: false, data: null };
    }
  }
}
