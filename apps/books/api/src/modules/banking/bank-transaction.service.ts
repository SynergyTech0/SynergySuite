import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalService } from '../journal/journal.service';
import { BankAccountService } from './bank-account.service';
import {
  CreateBankTransactionDto,
  CategorizeTransactionDto,
  TransactionStatus,
} from './dto/banking.dto';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { JournalSource, JournalType } from '../journal/dto/journal.dto';

type MatchCandidateJournal = Prisma.JournalGetPayload<{ include: { lines: true } }>;

type MatchableTransaction = {
  amount: Prisma.Decimal;
  transactionDate: Date;
  description: string | null;
};

@Injectable()
export class BankTransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalService: JournalService,
    private readonly bankAccountService: BankAccountService,
    @InjectQueue('bank-classification') private readonly classificationQueue: Queue,
  ) {}

  async create(organizationId: string, dto: CreateBankTransactionDto) {
    const bankAccount = await this.bankAccountService.findById(
      organizationId,
      dto.bankAccountId,
    );

    const transaction = await this.prisma.bankTransaction.create({
      data: {
        id: uuidv4(),
        bankAccountId: dto.bankAccountId,
        transactionDate: new Date(dto.transactionDate),
        transactionType: dto.type,
        amount: dto.amount,
        description: dto.description,
        reference: dto.reference,
        status: TransactionStatus.PENDING,
        categoryAccountId: dto.categoryAccountId,
        vendorId: dto.vendorId,
        customerId: dto.customerId,
      },
    });

    // Update bank account balance
    await this.bankAccountService.updateBalance(dto.bankAccountId);

    // Queue for auto-classification
    await this.classificationQueue.add('classify-transaction', {
      transactionId: transaction.id,
      organizationId,
    });

    return transaction;
  }

  async findAll(
    organizationId: string,
    options: {
      bankAccountId?: string;
      status?: TransactionStatus;
      startDate?: Date;
      endDate?: Date;
      uncategorized?: boolean;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const { bankAccountId, status, startDate, endDate, uncategorized, skip = 0, take = 50 } = options;

    const where: any = {
      bankAccount: { organizationId },
    };

    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (status) where.status = status;
    if (startDate) where.transactionDate = { ...where.transactionDate, gte: startDate };
    if (endDate) where.transactionDate = { ...where.transactionDate, lte: endDate };
    if (uncategorized) where.categoryAccountId = null;

    const [items, total] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        include: {
          bankAccount: { select: { id: true, accountName: true } },
          categoryAccount: { select: { id: true, accountNumber: true, name: true } },
          vendor: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          matchedJournal: { select: { id: true, journalNumber: true } },
        },
        orderBy: { transactionDate: 'desc' },
        skip,
        take,
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);

    return { items, total, page: Math.floor(skip / take) + 1, pageSize: take, totalPages: Math.ceil(total / take) };
  }

  async findById(organizationId: string, id: string) {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { organizationId } },
      include: {
        bankAccount: true,
        categoryAccount: true,
        vendor: true,
        customer: true,
        matchedJournal: { include: { lines: true } },
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }

    return transaction;
  }

  async categorize(organizationId: string, id: string, dto: CategorizeTransactionDto) {
    const transaction = await this.findById(organizationId, id);

    if (transaction.status === TransactionStatus.RECONCILED) {
      throw new BadRequestException('Cannot modify reconciled transaction');
    }

    // Update transaction category
    await this.prisma.bankTransaction.update({
      where: { id },
      data: {
        categoryAccountId: dto.accountId,
        vendorId: dto.vendorId,
        customerId: dto.customerId,
        description: dto.description || transaction.description,
      },
    });

    // Create journal entry if not already matched
    if (!transaction.matchedJournalId) {
      await this.createTransactionJournalEntry(organizationId, id);
    }

    // Create categorization rule if requested
    if (dto.createRule && transaction.description) {
      await this.createCategorizationRule(organizationId, transaction, dto);
    }

    return this.findById(organizationId, id);
  }

  async matchToJournal(organizationId: string, id: string, journalId: string) {
    const transaction = await this.findById(organizationId, id);
    const journal = await this.journalService.findById(organizationId, journalId);

    await this.prisma.bankTransaction.update({
      where: { id },
      data: {
        matchedJournalId: journalId,
        status: TransactionStatus.CLEARED,
      },
    });

    return this.findById(organizationId, id);
  }

  async exclude(organizationId: string, id: string) {
    const transaction = await this.findById(organizationId, id);

    await this.prisma.bankTransaction.update({
      where: { id },
      data: { status: TransactionStatus.EXCLUDED },
    });

    await this.bankAccountService.updateBalance(transaction.bankAccountId);

    return this.findById(organizationId, id);
  }

  async findPotentialMatches(organizationId: string, transactionId: string) {
    const transaction = await this.findById(organizationId, transactionId);
    const amount = parseFloat(transaction.amount.toString());
    const dateRange = 7; // days

    const startDate = new Date(transaction.transactionDate);
    startDate.setDate(startDate.getDate() - dateRange);
    const endDate = new Date(transaction.transactionDate);
    endDate.setDate(endDate.getDate() + dateRange);

    // Find unmatched journal entries with similar amounts
    const potentialMatches = await this.prisma.journal.findMany({
      where: {
        organizationId,
        status: 'POSTED',
        journalDate: { gte: startDate, lte: endDate },
        lines: {
          some: {
            accountId: transaction.bankAccount.accountId,
            OR: [
              { debit: { gte: amount * 0.99, lte: amount * 1.01 } },
              { credit: { gte: amount * 0.99, lte: amount * 1.01 } },
            ],
          },
        },
      },
      include: {
        lines: {
          include: { account: { select: { id: true, accountNumber: true, name: true } } },
        },
      },
      take: 10,
    });

    return potentialMatches.map((j) => ({
      journalId: j.id,
      entryNumber: j.journalNumber,
      date: j.journalDate,
      description: j.description,
      amount: this.journalAmount(j),
      matchScore: this.calculateMatchScore(transaction, j),
    }));
  }

  async getUncategorizedCount(organizationId: string, bankAccountId?: string) {
    const where: any = {
      bankAccount: { organizationId },
      categoryAccountId: null,
      matchedJournalId: null,
      status: { not: TransactionStatus.EXCLUDED },
    };

    if (bankAccountId) where.bankAccountId = bankAccountId;

    return this.prisma.bankTransaction.count({ where });
  }

  private async createTransactionJournalEntry(organizationId: string, transactionId: string) {
    const transaction = await this.findById(organizationId, transactionId);

    if (!transaction.categoryAccountId) return;

    const bankAccount = transaction.bankAccount;
    if (!bankAccount?.accountId) return;

    const amount = parseFloat(transaction.amount.toString());
    const lineDescription = transaction.description ?? undefined;
    // Money out of the bank (DEBIT): debit the category account, credit the bank GL account.
    // Money into the bank: debit the bank GL account, credit the category account.
    const lines = transaction.transactionType === 'DEBIT'
      ? [
          { accountId: transaction.categoryAccountId, debit: amount, description: lineDescription },
          { accountId: bankAccount.accountId, credit: amount, description: lineDescription },
        ]
      : [
          { accountId: bankAccount.accountId, debit: amount, description: lineDescription },
          { accountId: transaction.categoryAccountId, credit: amount, description: lineDescription },
        ];

    const journal = await this.journalService.create(organizationId, {
      date: transaction.transactionDate.toISOString(),
      type: JournalType.GENERAL,
      source: JournalSource.BANK_FEED,
      reference: transaction.reference || undefined,
      description: transaction.description || 'Bank transaction',
      lines,
    });

    await this.journalService.post(organizationId, journal.id);

    await this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        matchedJournalId: journal.id,
        status: TransactionStatus.CLEARED,
      },
    });
  }

  private async createCategorizationRule(
    organizationId: string,
    transaction: { description: string | null },
    categorization: CategorizeTransactionDto,
  ) {
    // Store rule for future auto-categorization
    await this.prisma.bankFeedRule.create({
      data: {
        id: uuidv4(),
        organizationId,
        name: `Auto-categorize: ${transaction.description?.substring(0, 50)}`,
        descriptionContains: transaction.description,
        matchPattern: transaction.description,
        matchType: 'CONTAINS',
        accountId: categorization.accountId,
        categoryAccountId: categorization.accountId,
        vendorId: categorization.vendorId,
        customerId: categorization.customerId,
        isActive: true,
      },
    });
  }

  /** Total of the journal's debit side (equals the credit side for a balanced entry). */
  private journalAmount(journal: MatchCandidateJournal): number {
    return journal.lines.reduce(
      (sum, l) => sum + Number(l.debit ?? 0) + Number(l.credit ?? 0),
      0,
    ) / 2;
  }

  private calculateMatchScore(transaction: MatchableTransaction, journal: MatchCandidateJournal): number {
    let score = 0;

    // Amount match
    const txnAmount = parseFloat(transaction.amount.toString());
    const journalAmount = this.journalAmount(journal);

    if (Math.abs(txnAmount - journalAmount) < 0.01) {
      score += 50;
    } else if (Math.abs(txnAmount - journalAmount) / txnAmount < 0.01) {
      score += 30;
    }

    // Date proximity
    const daysDiff = Math.abs(
      (new Date(transaction.transactionDate).getTime() - new Date(journal.journalDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    score += Math.max(0, 30 - daysDiff * 5);

    // Description similarity (simple)
    if (
      transaction.description &&
      journal.description &&
      transaction.description.toLowerCase().includes(journal.description.toLowerCase().substring(0, 10))
    ) {
      score += 20;
    }

    return Math.min(100, score);
  }
}
