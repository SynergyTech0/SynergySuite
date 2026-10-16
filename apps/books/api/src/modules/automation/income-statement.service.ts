import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LineItemAmount {
  amount: number;
  percentage?: number;
}

export interface IncomeStatementLineItem {
  name: string;
  amount: number;
  percentage?: number;
  subItems?: IncomeStatementLineItem[];
}

export interface IncomeStatement {
  organizationId: string;
  startDate: Date;
  endDate: Date;
  generatedAt: Date;

  // Revenue
  revenue: LineItemAmount;
  revenueByCategory?: IncomeStatementLineItem[];

  // COGS
  costOfGoodsSold: LineItemAmount;
  grossProfit: LineItemAmount;
  grossMarginPercent: number;

  // Operating Expenses
  operatingExpenses: LineItemAmount;
  operatingExpensesByCategory?: IncomeStatementLineItem[];
  operatingIncome: LineItemAmount;

  // Other Income/Expenses
  otherIncome: LineItemAmount;
  otherExpenses: LineItemAmount;
  interestExpense: LineItemAmount;

  // Bottom Line
  incomeBEforeTaxes: LineItemAmount;
  taxExpense: LineItemAmount;
  netIncome: LineItemAmount;

  // Metrics
  netMarginPercent: number;
  operatingMarginPercent: number;

  // Comparison (if applicable)
  priorPeriodComparison?: {
    revenue: { current: number; prior: number; variance: number; variancePercent: number };
    netIncome: { current: number; prior: number; variance: number; variancePercent: number };
  };

  // Budget comparison (if budgets exist)
  budgetComparison?: {
    revenue: { budgeted: number; actual: number; variance: number };
    expenses: { budgeted: number; actual: number; variance: number };
  };
}

@Injectable()
export class IncomeStatementService {
  private readonly logger = new Logger(IncomeStatementService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Generate Income Statement for period
   */
  async generateIncomeStatement(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<IncomeStatement> {
    try {
      this.logger.log(
        `Generating P&L for ${organizationId} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
      );

      // Fetch all transactions for period
      const expenses = await this.getExpensesByCategory(organizationId, startDate, endDate);
      const invoices = await this.getInvoiceRevenue(organizationId, startDate, endDate);
      const inventory = await this.calculateCOGS(organizationId, startDate, endDate);

      // Calculate line items
      const revenue = this.calculateRevenue(invoices);
      const cogs = inventory.total;
      const grossProfit = revenue.amount - cogs.amount;

      const operatingExpenses = this.calculateOperatingExpenses(expenses);
      const operatingIncome = grossProfit - operatingExpenses.amount;

      const otherIncome = await this.getOtherIncome(organizationId, startDate, endDate);
      const otherExpenses = await this.getOtherExpenses(organizationId, startDate, endDate);
      const interestExpense = await this.getInterestExpense(organizationId, startDate, endDate);

      const incomeBeforeTaxes =
        operatingIncome +
        otherIncome.amount -
        otherExpenses.amount -
        interestExpense.amount;
      const taxExpense = await this.calculateTaxExpense(organizationId, startDate, endDate);
      const netIncome = incomeBeforeTaxes - taxExpense.amount;

      // Calculate percentages (of revenue)
      const revenueAmount = revenue.amount || 1; // Avoid division by zero

      const statement: IncomeStatement = {
        organizationId,
        startDate,
        endDate,
        generatedAt: new Date(),

        revenue,
        revenueByCategory: this.groupByCategory(invoices),

        costOfGoodsSold: cogs,
        grossProfit: { amount: grossProfit, percentage: (grossProfit / revenueAmount) * 100 },
        grossMarginPercent: (grossProfit / revenueAmount) * 100,

        operatingExpenses,
        operatingExpensesByCategory: this.groupByCategory(expenses),
        operatingIncome: { amount: operatingIncome, percentage: (operatingIncome / revenueAmount) * 100 },

        otherIncome,
        otherExpenses,
        interestExpense,

        incomeBEforeTaxes: { amount: incomeBeforeTaxes, percentage: (incomeBeforeTaxes / revenueAmount) * 100 },
        taxExpense,
        netIncome: { amount: netIncome, percentage: (netIncome / revenueAmount) * 100 },

        netMarginPercent: (netIncome / revenueAmount) * 100,
        operatingMarginPercent: (operatingIncome / revenueAmount) * 100,
      };

      // Add comparisons if requested
      statement.budgetComparison = await this.getBudgetComparison(
        organizationId,
        startDate,
        endDate,
      );

      // Store in database for audit trail
      await this.storeIncomeStatement(statement);

      return statement;
    } catch (error) {
      this.logger.error('Failed to generate income statement:', error);
      throw error;
    }
  }

  /**
   * Get expenses grouped by category
   */
  private async getExpensesByCategory(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ category: string; amount: number }>> {
    const expenses = await this.prisma.expense.groupBy({
      by: ['category'],
      where: {
        organizationId,
        expenseDate: {
          gte: startDate,
          lte: endDate,
        },
        status: 'APPROVED',
      },
      _sum: {
        amount: true,
      },
    });

    return expenses.map((e) => ({
      category: e.category || 'Uncategorized',
      amount: e._sum?.amount?.toNumber() || 0,
    }));
  }

  /**
   * Get invoice revenue
   */
  private async getInvoiceRevenue(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ category: string; amount: number }>> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        invoiceDate: {
          gte: startDate,
          lte: endDate,
        },
        status: { in: ['APPROVED', 'PAID'] },
      },
      select: {
        totalAmount: true,
      },
    });

    const total = invoices.reduce((sum, inv) => sum + inv.totalAmount.toNumber(), 0);
    return [{ category: 'Product Sales', amount: total }];
  }

  /**
   * Calculate COGS from inventory
   */
  private async calculateCOGS(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ total: { amount: number; percentage?: number }; items: Array<{ name: string; amount: number }> }> {
    const inventory = await this.prisma.goodsReceipt.findMany({
      where: {
        organizationId,
        receiptDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        lineItems: true,
      },
    });

    const total = inventory.reduce((sum, gr) => {
      const itemSum = gr.lineItems.reduce((s, item) => s + item.cost.toNumber(), 0);
      return sum + itemSum;
    }, 0);

    return {
      total: { amount: total },
      items: [{ name: 'Cost of Goods Sold', amount: total }],
    };
  }

  /**
   * Get other income
   */
  private async getOtherIncome(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ amount: number; percentage?: number }> {
    const payments = await this.prisma.payment.findMany({
      where: {
        organizationId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        type: 'INCOME_OTHER',
      },
      select: { amount: true },
    });

    const total = payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
    return { amount: total };
  }

  /**
   * Get other expenses
   */
  private async getOtherExpenses(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ amount: number; percentage?: number }> {
    const payments = await this.prisma.payment.findMany({
      where: {
        organizationId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        type: 'EXPENSE_OTHER',
      },
      select: { amount: true },
    });

    const total = payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
    return { amount: total };
  }

  /**
   * Get interest expense
   */
  private async getInterestExpense(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ amount: number; percentage?: number }> {
    const payments = await this.prisma.payment.findMany({
      where: {
        organizationId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        type: 'INTEREST',
      },
      select: { amount: true },
    });

    const total = payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
    return { amount: total };
  }

  /**
   * Calculate tax expense
   */
  private async calculateTaxExpense(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ amount: number; percentage?: number }> {
    // Placeholder - actual tax calculation depends on entity type
    return { amount: 0 };
  }

  /**
   * Calculate revenue
   */
  private calculateRevenue(items: Array<{ category: string; amount: number }>): LineItemAmount {
    const amount = items.reduce((sum, item) => sum + item.amount, 0);
    return { amount };
  }

  /**
   * Calculate operating expenses
   */
  private calculateOperatingExpenses(items: Array<{ category: string; amount: number }>): LineItemAmount {
    const amount = items.reduce((sum, item) => sum + item.amount, 0);
    return { amount };
  }

  /**
   * Group items by category for hierarchical display
   */
  private groupByCategory(items: Array<{ category: string; amount: number }>): IncomeStatementLineItem[] {
    const grouped = new Map<string, number>();

    for (const item of items) {
      const current = grouped.get(item.category) || 0;
      grouped.set(item.category, current + item.amount);
    }

    return Array.from(grouped.entries()).map(([category, amount]) => ({
      name: category,
      amount,
    }));
  }

  /**
   * Get budget comparison
   */
  private async getBudgetComparison(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    const budget = await this.prisma.budget.findFirst({
      where: {
        organizationId,
        startDate: {
          lte: startDate,
        },
        endDate: {
          gte: endDate,
        },
      },
      include: {
        lineItems: true,
      },
    });

    if (!budget) return undefined;

    const budgetedRevenue = budget.lineItems
      .filter((li) => li.type === 'REVENUE')
      .reduce((sum, li) => sum + li.amount.toNumber(), 0);

    const budgetedExpenses = budget.lineItems
      .filter((li) => li.type === 'EXPENSE')
      .reduce((sum, li) => sum + li.amount.toNumber(), 0);

    const actualRevenue = await this.getActualRevenue(organizationId, startDate, endDate);
    const actualExpenses = await this.getActualExpenses(organizationId, startDate, endDate);

    return {
      revenue: {
        budgeted: budgetedRevenue,
        actual: actualRevenue,
        variance: actualRevenue - budgetedRevenue,
      },
      expenses: {
        budgeted: budgetedExpenses,
        actual: actualExpenses,
        variance: actualExpenses - budgetedExpenses,
      },
    };
  }

  /**
   * Get actual revenue for period
   */
  private async getActualRevenue(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        invoiceDate: { gte: startDate, lte: endDate },
        status: { in: ['APPROVED', 'PAID'] },
      },
      select: { totalAmount: true },
    });

    return invoices.reduce((sum, inv) => sum + inv.totalAmount.toNumber(), 0);
  }

  /**
   * Get actual expenses for period
   */
  private async getActualExpenses(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId,
        expenseDate: { gte: startDate, lte: endDate },
        status: 'APPROVED',
      },
      select: { amount: true },
    });

    return expenses.reduce((sum, exp) => sum + exp.amount.toNumber(), 0);
  }

  /**
   * Store income statement in database
   */
  private async storeIncomeStatement(statement: IncomeStatement): Promise<void> {
    // Implementation depends on your schema
    this.logger.log(`Stored income statement for ${statement.organizationId}`);
  }

  /**
   * Get income statement from cache/database
   */
  async getIncomeStatement(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<IncomeStatement | null> {
    // Try to get from cache first
    const cached = await this.prisma.incomeStatement.findFirst({
      where: {
        organizationId,
        periodStartDate: startDate,
        periodEndDate: endDate,
      },
    });

    if (cached) {
      return JSON.parse(cached.data);
    }

    return null;
  }

  /**
   * Generate P&L for current month
   */
  async generateCurrentMonthP_L(organizationId: string): Promise<IncomeStatement> {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return this.generateIncomeStatement(organizationId, startDate, endDate);
  }

  /**
   * Generate P&L for last 12 months
   */
  async generateYearToDateP_L(organizationId: string): Promise<IncomeStatement> {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), 0, 1);
    const endDate = now;

    return this.generateIncomeStatement(organizationId, startDate, endDate);
  }

  /**
   * Generate P&L for specific quarter
   */
  async generateQuarterlyP_L(organizationId: string, quarter: 1 | 2 | 3 | 4, year: number): Promise<IncomeStatement> {
    const startMonth = (quarter - 1) * 3;
    const startDate = new Date(year, startMonth, 1);
    const endDate = new Date(year, startMonth + 3, 0);

    return this.generateIncomeStatement(organizationId, startDate, endDate);
  }
}
