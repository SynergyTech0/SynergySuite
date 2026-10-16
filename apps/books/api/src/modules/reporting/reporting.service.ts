import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountService } from '../account/account.service';
import { Decimal } from 'decimal.js';

/** An account row with a computed balance, as grouped into report sections. */
interface ReportAccountBalance {
  accountNumber: string;
  name: string;
  accountSubtype: string | null;
  balance: number;
}

interface ReportOptions {
  asOfDate?: Date;
  startDate?: Date;
  endDate?: Date;
  fiscalPeriodId?: string;
  comparePriorPeriod?: boolean;
}

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
  ) {}

  async generateBalanceSheet(organizationId: string, options: ReportOptions = {}) {
    const asOfDate = options.asOfDate || new Date();

    // Get all accounts with balances
    const accounts = await this.prisma.account.findMany({
      where: { organizationId, isActive: true },
      orderBy: { accountNumber: 'asc' },
    });

    const balances = await Promise.all(
      accounts.map(async (account) => {
        const balance = await this.accountService.getBalance(
          organizationId,
          account.id,
          { asOfDate },
        );
        return { ...account, ...balance };
      }),
    );

    // Group by account type
    const assets = balances.filter((b) => b.accountType === 'ASSET');
    const liabilities = balances.filter((b) => b.accountType === 'LIABILITY');
    const equity = balances.filter((b) => b.accountType === 'EQUITY');

    // Calculate totals
    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
    const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0);

    // Get retained earnings (net income)
    const netIncome = await this.calculateNetIncome(organizationId, {
      endDate: asOfDate,
    });

    return {
      reportType: 'BALANCE_SHEET',
      asOfDate,
      organizationId,
      sections: {
        assets: {
          title: 'Assets',
          accounts: this.groupAccountsBySubType(assets),
          total: totalAssets,
        },
        liabilities: {
          title: 'Liabilities',
          accounts: this.groupAccountsBySubType(liabilities),
          total: totalLiabilities,
        },
        equity: {
          title: 'Stockholders\' Equity',
          accounts: this.groupAccountsBySubType(equity),
          retainedEarnings: netIncome,
          total: totalEquity + netIncome,
        },
      },
      totals: {
        totalAssets,
        totalLiabilities,
        totalEquity: totalEquity + netIncome,
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + netIncome)) < 0.01,
      },
    };
  }

  async generateIncomeStatement(organizationId: string, options: ReportOptions = {}) {
    const startDate = options.startDate || new Date(new Date().getFullYear(), 0, 1);
    const endDate = options.endDate || new Date();

    const accounts = await this.prisma.account.findMany({
      where: {
        organizationId,
        isActive: true,
        accountType: { in: ['REVENUE', 'EXPENSE'] },
      },
      orderBy: { accountNumber: 'asc' },
    });

    const balances = await Promise.all(
      accounts.map(async (account) => {
        const activity = await this.getAccountActivityForPeriod(
          organizationId,
          account.id,
          startDate,
          endDate,
        );
        // Present each balance on its normal side so revenue (credit-normal)
        // and expenses (debit-normal) are both positive amounts.
        const balance =
          account.normalBalance === 'CREDIT' ? -activity.balance : activity.balance;
        return { ...account, ...activity, balance };
      }),
    );

    const revenue = balances.filter((b) => b.accountType === 'REVENUE');
    const expenses = balances.filter((b) => b.accountType === 'EXPENSE');

    const totalRevenue = revenue.reduce((sum, r) => sum + r.balance, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.balance, 0);
    const netIncome = totalRevenue - totalExpenses;

    // Get COGS separately
    const cogs = expenses.filter((e) => e.accountSubtype === 'COST_OF_GOODS_SOLD');
    const operatingExpenses = expenses.filter((e) => e.accountSubtype === 'OPERATING_EXPENSE');
    const otherExpenses = expenses.filter(
      (e) => !['COST_OF_GOODS_SOLD', 'OPERATING_EXPENSE'].includes(e.accountSubtype || ''),
    );

    const grossProfit = totalRevenue - cogs.reduce((sum, c) => sum + c.balance, 0);

    return {
      reportType: 'INCOME_STATEMENT',
      periodStart: startDate,
      periodEnd: endDate,
      organizationId,
      sections: {
        revenue: {
          title: 'Revenue',
          accounts: this.groupAccountsBySubType(revenue),
          total: totalRevenue,
        },
        costOfGoodsSold: {
          title: 'Cost of Goods Sold',
          accounts: cogs.map((c) => ({
            code: c.accountNumber,
            name: c.name,
            balance: c.balance,
          })),
          total: cogs.reduce((sum, c) => sum + c.balance, 0),
        },
        grossProfit: {
          title: 'Gross Profit',
          amount: grossProfit,
        },
        operatingExpenses: {
          title: 'Operating Expenses',
          accounts: operatingExpenses.map((e) => ({
            code: e.accountNumber,
            name: e.name,
            balance: e.balance,
          })),
          total: operatingExpenses.reduce((sum, e) => sum + e.balance, 0),
        },
        otherExpenses: {
          title: 'Other Expenses',
          accounts: otherExpenses.map((e) => ({
            code: e.accountNumber,
            name: e.name,
            balance: e.balance,
          })),
          total: otherExpenses.reduce((sum, e) => sum + e.balance, 0),
        },
      },
      totals: {
        totalRevenue,
        totalCOGS: cogs.reduce((sum, c) => sum + c.balance, 0),
        grossProfit,
        totalOperatingExpenses: operatingExpenses.reduce((sum, e) => sum + e.balance, 0),
        totalOtherExpenses: otherExpenses.reduce((sum, e) => sum + e.balance, 0),
        totalExpenses,
        netIncome,
      },
    };
  }

  async generateCashFlowStatement(organizationId: string, options: ReportOptions = {}) {
    const startDate = options.startDate || new Date(new Date().getFullYear(), 0, 1);
    const endDate = options.endDate || new Date();

    // Get cash account activity
    const cashAccounts = await this.prisma.account.findMany({
      where: {
        organizationId,
        accountSubtype: 'CURRENT_ASSET',
        OR: [
          { accountNumber: { startsWith: '100' } },
          { accountNumber: { startsWith: '101' } },
          { name: { contains: 'Cash', mode: 'insensitive' } },
        ],
      },
    });

    // Get net income for operating activities
    const netIncome = await this.calculateNetIncome(organizationId, {
      startDate,
      endDate,
    });

    // Get changes in working capital
    const arChange = await this.getAccountChangeForPeriod(
      organizationId,
      '1100', // AR code
      startDate,
      endDate,
    );

    const apChange = await this.getAccountChangeForPeriod(
      organizationId,
      '2000', // AP code
      startDate,
      endDate,
    );

    const inventoryChange = await this.getAccountChangeForPeriod(
      organizationId,
      '1200', // Inventory code
      startDate,
      endDate,
    );

    // Get depreciation add-back
    const depreciationAccount = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '6900' }, // Depreciation expense code
      select: { id: true },
    });
    const depreciation = depreciationAccount
      ? await this.getAccountActivityForPeriod(
          organizationId,
          depreciationAccount.id,
          startDate,
          endDate,
        )
      : null;

    const operatingCashFlow =
      netIncome +
      (depreciation?.balance || 0) -
      arChange -
      inventoryChange +
      apChange;

    // Get investing activities (fixed asset changes)
    const fixedAssetChange = await this.getFixedAssetChanges(
      organizationId,
      startDate,
      endDate,
    );

    // Get financing activities
    const debtChange = await this.getDebtChanges(organizationId, startDate, endDate);
    const equityChange = await this.getEquityChanges(organizationId, startDate, endDate);

    return {
      reportType: 'CASH_FLOW_STATEMENT',
      periodStart: startDate,
      periodEnd: endDate,
      organizationId,
      sections: {
        operatingActivities: {
          title: 'Cash Flows from Operating Activities',
          netIncome,
          adjustments: [
            { description: 'Depreciation and Amortization', amount: depreciation?.balance || 0 },
            { description: 'Decrease (Increase) in Accounts Receivable', amount: -arChange },
            { description: 'Decrease (Increase) in Inventory', amount: -inventoryChange },
            { description: 'Increase (Decrease) in Accounts Payable', amount: apChange },
          ],
          total: operatingCashFlow,
        },
        investingActivities: {
          title: 'Cash Flows from Investing Activities',
          items: [
            { description: 'Purchase of Fixed Assets', amount: -fixedAssetChange },
          ],
          total: -fixedAssetChange,
        },
        financingActivities: {
          title: 'Cash Flows from Financing Activities',
          items: [
            { description: 'Proceeds from (Repayment of) Debt', amount: debtChange },
            { description: 'Equity Contributions (Distributions)', amount: equityChange },
          ],
          total: debtChange + equityChange,
        },
      },
      totals: {
        operatingCashFlow,
        investingCashFlow: -fixedAssetChange,
        financingCashFlow: debtChange + equityChange,
        netChangeInCash: operatingCashFlow - fixedAssetChange + debtChange + equityChange,
      },
    };
  }

  async generateTrialBalance(organizationId: string, options: ReportOptions = {}) {
    return this.accountService.getTrialBalance(organizationId, {
      asOfDate: options.asOfDate,
      fiscalPeriodId: options.fiscalPeriodId,
    });
  }

  async generateGeneralLedger(
    organizationId: string,
    options: ReportOptions & { accountIds?: string[] } = {},
  ) {
    const accounts = options.accountIds
      ? await this.prisma.account.findMany({
          where: { id: { in: options.accountIds }, organizationId },
        })
      : await this.prisma.account.findMany({
          where: { organizationId, isActive: true },
          orderBy: { accountNumber: 'asc' },
        });

    const ledgers = await Promise.all(
      accounts.map(async (account) => {
        const entries = await this.prisma.journalLine.findMany({
          where: {
            accountId: account.id,
            journal: {
              organizationId,
              status: 'POSTED',
              journalDate: {
                gte: options.startDate,
                lte: options.endDate || new Date(),
              },
            },
          },
          include: {
            journal: {
              select: {
                journalNumber: true,
                journalDate: true,
                description: true,
                reference: true,
              },
            },
          },
          orderBy: [{ journal: { journalDate: 'asc' } }, { lineNumber: 'asc' }],
        });

        // Calculate running balance
        let runningBalance = new Decimal(0);
        const entriesWithBalance = entries.map((entry) => {
          const debit = entry.debit ? new Decimal(entry.debit.toString()) : new Decimal(0);
          const credit = entry.credit ? new Decimal(entry.credit.toString()) : new Decimal(0);

          if (account.normalBalance === 'DEBIT') {
            runningBalance = runningBalance.plus(debit).minus(credit);
          } else {
            runningBalance = runningBalance.plus(credit).minus(debit);
          }

          return {
            date: entry.journal.journalDate,
            entryNumber: entry.journal.journalNumber,
            description: entry.description || entry.journal.description,
            reference: entry.journal.reference,
            debit: debit.toNumber(),
            credit: credit.toNumber(),
            balance: runningBalance.toNumber(),
          };
        });

        return {
          account: {
            id: account.id,
            code: account.accountNumber,
            name: account.name,
            type: account.accountType,
            normalBalance: account.normalBalance,
          },
          entries: entriesWithBalance,
          summary: {
            totalDebits: entries.reduce(
              (sum, e) => sum + (e.debit ? parseFloat(e.debit.toString()) : 0),
              0,
            ),
            totalCredits: entries.reduce(
              (sum, e) => sum + (e.credit ? parseFloat(e.credit.toString()) : 0),
              0,
            ),
            endingBalance: runningBalance.toNumber(),
          },
        };
      }),
    );

    return {
      reportType: 'GENERAL_LEDGER',
      periodStart: options.startDate,
      periodEnd: options.endDate || new Date(),
      organizationId,
      accounts: ledgers,
    };
  }

  private async calculateNetIncome(
    organizationId: string,
    options: { startDate?: Date; endDate?: Date } = {},
  ): Promise<number> {
    const incomeStatement = await this.generateIncomeStatement(organizationId, options);
    return incomeStatement.totals.netIncome;
  }

  private async getAccountActivityForPeriod(
    organizationId: string,
    accountId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId,
        journal: {
          organizationId,
          status: 'POSTED',
          journalDate: { gte: startDate, lte: endDate },
        },
      },
    });

    const totalDebits = lines.reduce(
      (sum, l) => sum + (l.debit ? parseFloat(l.debit.toString()) : 0),
      0,
    );
    const totalCredits = lines.reduce(
      (sum, l) => sum + (l.credit ? parseFloat(l.credit.toString()) : 0),
      0,
    );

    return {
      totalDebits,
      totalCredits,
      balance: totalDebits - totalCredits,
    };
  }

  private async getAccountChangeForPeriod(
    organizationId: string,
    accountCode: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      const account = await this.prisma.account.findFirst({
        where: { organizationId, accountNumber: accountCode },
      });

      if (!account) return 0;

      const beginningBalance = await this.accountService.getBalance(
        organizationId,
        account.id,
        { asOfDate: startDate },
      );

      const endingBalance = await this.accountService.getBalance(
        organizationId,
        account.id,
        { asOfDate: endDate },
      );

      return endingBalance.balance - beginningBalance.balance;
    } catch {
      return 0;
    }
  }

  private async getFixedAssetChanges(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const fixedAssetAccounts = await this.prisma.account.findMany({
      where: { organizationId, accountSubtype: 'FIXED_ASSET' },
    });

    let totalChange = 0;
    for (const account of fixedAssetAccounts) {
      const change = await this.getAccountChangeForPeriod(
        organizationId,
        account.accountNumber,
        startDate,
        endDate,
      );
      totalChange += change;
    }

    return totalChange;
  }

  private async getDebtChanges(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const debtAccounts = await this.prisma.account.findMany({
      where: {
        organizationId,
        accountType: 'LIABILITY',
        accountSubtype: { in: ['CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'] },
        OR: [
          { name: { contains: 'Loan', mode: 'insensitive' } },
          { name: { contains: 'Debt', mode: 'insensitive' } },
          { name: { contains: 'Notes Payable', mode: 'insensitive' } },
        ],
      },
    });

    let totalChange = 0;
    for (const account of debtAccounts) {
      const change = await this.getAccountChangeForPeriod(
        organizationId,
        account.accountNumber,
        startDate,
        endDate,
      );
      totalChange += change;
    }

    return totalChange;
  }

  private async getEquityChanges(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const equityAccounts = await this.prisma.account.findMany({
      where: {
        organizationId,
        accountType: 'EQUITY',
        accountSubtype: 'EQUITY',
      },
    });

    let totalChange = 0;
    for (const account of equityAccounts) {
      const change = await this.getAccountChangeForPeriod(
        organizationId,
        account.accountNumber,
        startDate,
        endDate,
      );
      totalChange += change;
    }

    return totalChange;
  }

  private groupAccountsBySubType(accounts: ReportAccountBalance[]) {
    const groups: Record<string, Array<{ code: string; name: string; balance: number }>> = {};

    for (const account of accounts) {
      const subType = account.accountSubtype || 'Other';
      if (!groups[subType]) {
        groups[subType] = [];
      }
      groups[subType].push({
        code: account.accountNumber,
        name: account.name,
        balance: account.balance,
      });
    }

    return Object.entries(groups).map(([subType, items]) => ({
      subType: this.formatSubTypeLabel(subType),
      accounts: items,
      subtotal: items.reduce((sum, a) => sum + a.balance, 0),
    }));
  }

  private formatSubTypeLabel(subType: string): string {
    return subType
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
