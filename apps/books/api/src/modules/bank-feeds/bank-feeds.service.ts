import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

// Mock Plaid/Yodlee interfaces
export interface BankFeedConfig {
  provider: 'PLAID' | 'YODLEE' | 'MANUAL';
  accessToken?: string;
  itemId?: string;
  accountId?: string;
}

@Injectable()
export class BankFeedsService {
  private readonly logger = new Logger(BankFeedsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createConnection(
    organizationId: string,
    bankAccountId: string,
    config: BankFeedConfig,
  ) {
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
    });

    if (!bankAccount) throw new NotFoundException('Bank account not found');

    return this.prisma.bankFeedConnection.create({
      data: {
        bankAccountId,
        provider: config.provider,
        status: config.provider === 'MANUAL' ? 'CONNECTED' : 'PENDING',
        plaidItemId: config.itemId,
        plaidAccessToken: config.accessToken,
        plaidAccountId: config.accountId,
        autoSync: config.provider !== 'MANUAL',
        syncFrequencyHours: 24,
        syncHistoryDays: 90,
      },
    });
  }

  async getConnections(organizationId: string) {
    return this.prisma.bankFeedConnection.findMany({
      where: { bankAccount: { organizationId } },
      include: { bankAccount: { select: { id: true, bankName: true, accountName: true } } },
    });
  }

  async syncTransactions(connectionId: string) {
    const connection = await this.prisma.bankFeedConnection.findUnique({
      where: { id: connectionId },
      include: { bankAccount: true },
    });

    if (!connection) throw new NotFoundException('Connection not found');
    if (connection.status !== 'CONNECTED') throw new BadRequestException('Connection not active');

    const sync = await this.prisma.bankFeedSync.create({
      data: {
        connectionId,
        syncType: 'INCREMENTAL',
        status: 'IN_PROGRESS',
        fromDate: connection.lastSuccessfulSync || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        toDate: new Date(),
      },
    });

    try {
      let transactions: any[] = [];

      if (connection.provider === 'PLAID') {
        transactions = await this.fetchPlaidTransactions(connection);
      } else if (connection.provider === 'YODLEE') {
        transactions = await this.fetchYodleeTransactions(connection);
      }

      let newCount = 0;
      let duplicateCount = 0;

      for (const txn of transactions) {
        const existing = await this.prisma.bankTransaction.findFirst({
          where: { bankAccountId: connection.bankAccountId, externalId: txn.id },
        });

        if (existing) {
          duplicateCount++;
          continue;
        }

        await this.prisma.bankTransaction.create({
          data: {
            bankAccountId: connection.bankAccountId,
            externalId: txn.id,
            transactionDate: txn.date,
            postDate: txn.postDate,
            description: txn.description,
            originalDescription: txn.originalDescription,
            amount: new Prisma.Decimal(Math.abs(txn.amount)),
            transactionType: txn.amount < 0 ? 'DEBIT' : 'CREDIT',
            category: txn.category,
            merchantName: txn.merchantName,
            pending: txn.pending || false,
            status: 'UNMATCHED',
            metadata: txn.metadata,
          },
        });
        newCount++;
      }

      await this.prisma.bankFeedSync.update({
        where: { id: sync.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          transactionsFound: transactions.length,
          transactionsNew: newCount,
          transactionsDuplicate: duplicateCount,
          durationMs: Date.now() - sync.startedAt.getTime(),
        },
      });

      await this.prisma.bankFeedConnection.update({
        where: { id: connectionId },
        data: {
          lastSuccessfulSync: new Date(),
          lastAttemptedSync: new Date(),
          consecutiveFailures: 0,
        },
      });

      return { syncId: sync.id, found: transactions.length, new: newCount, duplicates: duplicateCount };
    } catch (error) {
      await this.prisma.bankFeedSync.update({
        where: { id: sync.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorCode: (error as { code?: string }).code ?? null,
          errorMessage: (error as Error).message,
        },
      });

      await this.prisma.bankFeedConnection.update({
        where: { id: connectionId },
        data: { consecutiveFailures: { increment: 1 }, lastAttemptedSync: new Date() },
      });

      throw error;
    }
  }

  private async fetchPlaidTransactions(connection: any): Promise<any[]> {
    // Mock Plaid API call - in production, use Plaid SDK
    this.logger.log(`Fetching Plaid transactions for ${connection.plaidAccountId}`);
    return [];
  }

  private async fetchYodleeTransactions(connection: any): Promise<any[]> {
    // Mock Yodlee API call - in production, use Yodlee SDK
    this.logger.log(`Fetching Yodlee transactions for ${connection.yodleeAccountId}`);
    return [];
  }

  // Bank Feed Rules
  async createRule(
    organizationId: string,
    rule: {
      name: string;
      descriptionContains?: string;
      descriptionPattern?: string;
      merchantName?: string;
      minAmount?: number;
      maxAmount?: number;
      transactionType?: string;
      accountId?: string;
      taxClassification?: string;
      vendorId?: string;
      customerId?: string;
      classId?: string;
      locationId?: string;
      memo?: string;
      autoApprove?: boolean;
      autoCreateJournal?: boolean;
    },
  ) {
    return this.prisma.bankFeedRule.create({
      data: {
        organizationId,
        name: rule.name,
        isActive: true,
        priority: 100,
        descriptionContains: rule.descriptionContains,
        descriptionPattern: rule.descriptionPattern,
        merchantName: rule.merchantName,
        minAmount: rule.minAmount ? new Prisma.Decimal(rule.minAmount) : null,
        maxAmount: rule.maxAmount ? new Prisma.Decimal(rule.maxAmount) : null,
        transactionType: rule.transactionType as any,
        accountId: rule.accountId,
        taxClassification: rule.taxClassification,
        vendorId: rule.vendorId,
        customerId: rule.customerId,
        classId: rule.classId,
        locationId: rule.locationId,
        memo: rule.memo,
        autoApprove: rule.autoApprove || false,
        autoCreateJournal: rule.autoCreateJournal || false,
        autoMatch: true,
        createdBy: 'system',
      },
    });
  }

  async getRules(organizationId: string) {
    return this.prisma.bankFeedRule.findMany({
      where: { organizationId, isActive: true },
      orderBy: { priority: 'asc' },
    });
  }

  async applyRules(organizationId: string, transactionId: string) {
    const transaction = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: { bankAccount: true },
    });

    if (!transaction || transaction.bankAccount.organizationId !== organizationId) {
      throw new NotFoundException('Transaction not found');
    }

    const rules = await this.getRules(organizationId);

    for (const rule of rules) {
      if (this.matchesRule(transaction, rule)) {
        await this.prisma.bankTransaction.update({
          where: { id: transactionId },
          data: {
            category: rule.accountId ? 'CATEGORIZED' : transaction.category,
            matchMethod: 'RULE_BASED',
          },
        });

        await this.prisma.bankFeedRule.update({
          where: { id: rule.id },
          data: { timesMatched: { increment: 1 }, lastMatchedAt: new Date() },
        });

        return { matched: true, ruleId: rule.id, ruleName: rule.name };
      }
    }

    return { matched: false };
  }

  private matchesRule(transaction: any, rule: any): boolean {
    if (rule.descriptionContains) {
      if (!transaction.description?.toLowerCase().includes(rule.descriptionContains.toLowerCase())) {
        return false;
      }
    }

    if (rule.merchantName) {
      if (transaction.merchantName?.toLowerCase() !== rule.merchantName.toLowerCase()) {
        return false;
      }
    }

    if (rule.minAmount && Number(transaction.amount) < Number(rule.minAmount)) return false;
    if (rule.maxAmount && Number(transaction.amount) > Number(rule.maxAmount)) return false;
    if (rule.transactionType && transaction.transactionType !== rule.transactionType) return false;

    return true;
  }

  async getUnmatchedTransactions(organizationId: string, bankAccountId?: string) {
    return this.prisma.bankTransaction.findMany({
      where: {
        bankAccount: { organizationId },
        status: 'UNMATCHED',
        ...(bankAccountId && { bankAccountId }),
      },
      orderBy: { transactionDate: 'desc' },
      take: 100,
    });
  }

  async matchTransaction(
    transactionId: string,
    journalId: string,
    matchMethod: 'EXACT_MATCH' | 'FUZZY_MATCH' | 'MANUAL',
    confidence?: number,
  ) {
    return this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        matchedJournalId: journalId,
        status: 'MATCHED',
        matchMethod,
        matchConfidence: confidence,
      },
    });
  }
}
