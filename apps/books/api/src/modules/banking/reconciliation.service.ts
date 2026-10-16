import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BankAccountService } from './bank-account.service';
import {
  StartReconciliationDto,
  ReconciliationStatus,
  TransactionStatus,
} from './dto/banking.dto';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { BankTransactionType } from '@prisma/client';

/** CREDIT/DEPOSIT bring money into the account; DEBIT/ADJUSTMENT take it out. */
const isInflow = (type: BankTransactionType): boolean => type === 'CREDIT' || type === 'DEPOSIT';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  async start(organizationId: string, dto: StartReconciliationDto) {
    const bankAccount = await this.bankAccountService.findById(
      organizationId,
      dto.bankAccountId,
    );

    // Check for existing in-progress reconciliation
    const existing = await this.prisma.bankReconciliation.findFirst({
      where: {
        bankAccountId: dto.bankAccountId,
        status: ReconciliationStatus.IN_PROGRESS,
      },
    });

    if (existing) {
      throw new BadRequestException(
        'There is already a reconciliation in progress for this account',
      );
    }

    // Get the last completed reconciliation for beginning balance
    const lastReconciliation = await this.prisma.bankReconciliation.findFirst({
      where: {
        bankAccountId: dto.bankAccountId,
        status: ReconciliationStatus.COMPLETED,
      },
      orderBy: { periodEnd: 'desc' },
    });

    const beginningBalance = lastReconciliation
      ? parseFloat(lastReconciliation.statementBalance.toString())
      : 0;

    return this.prisma.bankReconciliation.create({
      data: {
        id: uuidv4(),
        bankAccountId: dto.bankAccountId,
        periodEnd: new Date(dto.statementDate),
        statementBalance: dto.statementEndingBalance,
        beginningBalance,
        clearedBalance: beginningBalance,
        difference: new Decimal(dto.statementEndingBalance).minus(beginningBalance).toNumber(),
        status: ReconciliationStatus.IN_PROGRESS,
      },
    });
  }

  async findById(organizationId: string, id: string) {
    const reconciliation = await this.prisma.bankReconciliation.findFirst({
      where: { id, bankAccount: { organizationId } },
      include: {
        bankAccount: { select: { id: true, accountName: true, accountId: true } },
      },
    });

    if (!reconciliation) {
      throw new NotFoundException(`Reconciliation ${id} not found`);
    }

    return reconciliation;
  }

  async getTransactionsToReconcile(organizationId: string, reconciliationId: string) {
    const reconciliation = await this.findById(organizationId, reconciliationId);

    // Get all cleared/pending transactions up to statement date
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        bankAccountId: reconciliation.bankAccountId,
        transactionDate: { lte: reconciliation.periodEnd },
        status: { in: [TransactionStatus.PENDING, TransactionStatus.CLEARED] },
      },
      orderBy: { transactionDate: 'asc' },
    });

    // Calculate totals
    let clearedDebits = 0;
    let clearedCredits = 0;
    let unclearedDebits = 0;
    let unclearedCredits = 0;

    for (const txn of transactions) {
      const amount = parseFloat(txn.amount.toString());
      if (txn.status === TransactionStatus.CLEARED) {
        if (!isInflow(txn.transactionType)) clearedDebits += amount;
        else clearedCredits += amount;
      } else {
        if (!isInflow(txn.transactionType)) unclearedDebits += amount;
        else unclearedCredits += amount;
      }
    }

    const beginningBalance = parseFloat(reconciliation.beginningBalance.toString());
    const statementEndingBalance = parseFloat(reconciliation.statementBalance.toString());
    const clearedBalance = beginningBalance + clearedCredits - clearedDebits;
    const difference = statementEndingBalance - clearedBalance;

    return {
      reconciliationId,
      statementDate: reconciliation.periodEnd,
      beginningBalance,
      statementEndingBalance,
      clearedBalance,
      difference,
      summary: {
        clearedDebits,
        clearedCredits,
        unclearedDebits,
        unclearedCredits,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        date: t.transactionDate,
        type: t.transactionType,
        amount: parseFloat(t.amount.toString()),
        description: t.description,
        reference: t.reference,
        status: t.status,
        isCleared: t.status === TransactionStatus.CLEARED,
      })),
    };
  }

  async toggleTransactionCleared(
    organizationId: string,
    reconciliationId: string,
    transactionId: string,
  ) {
    const reconciliation = await this.findById(organizationId, reconciliationId);

    if (reconciliation.status !== ReconciliationStatus.IN_PROGRESS) {
      throw new BadRequestException('Reconciliation is not in progress');
    }

    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id: transactionId, bankAccountId: reconciliation.bankAccountId },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    // Toggle between PENDING and CLEARED
    const newStatus =
      transaction.status === TransactionStatus.CLEARED
        ? TransactionStatus.PENDING
        : TransactionStatus.CLEARED;

    await this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: { status: newStatus },
    });

    // Recalculate and update reconciliation
    await this.updateReconciliationTotals(reconciliationId);

    return this.getTransactionsToReconcile(organizationId, reconciliationId);
  }

  async complete(organizationId: string, id: string) {
    const reconciliation = await this.findById(organizationId, id);

    if (reconciliation.status !== ReconciliationStatus.IN_PROGRESS) {
      throw new BadRequestException('Reconciliation is not in progress');
    }

    // Calculate current difference
    const summary = await this.getTransactionsToReconcile(organizationId, id);

    if (Math.abs(summary.difference) > 0.01) {
      throw new BadRequestException(
        `Cannot complete reconciliation with difference of ${summary.difference}. Difference must be zero.`,
      );
    }

    // Mark all cleared transactions as reconciled
    await this.prisma.bankTransaction.updateMany({
      where: {
        bankAccountId: reconciliation.bankAccountId,
        transactionDate: { lte: reconciliation.periodEnd },
        status: TransactionStatus.CLEARED,
      },
      data: { status: TransactionStatus.RECONCILED },
    });

    // Complete reconciliation
    await this.prisma.bankReconciliation.update({
      where: { id },
      data: {
        status: ReconciliationStatus.COMPLETED,
        completedAt: new Date(),
        clearedBalance: summary.clearedBalance,
        difference: 0,
      },
    });

    return this.findById(organizationId, id);
  }

  async abandon(organizationId: string, id: string) {
    const reconciliation = await this.findById(organizationId, id);

    if (reconciliation.status !== ReconciliationStatus.IN_PROGRESS) {
      throw new BadRequestException('Reconciliation is not in progress');
    }

    // Reset all cleared transactions back to pending
    await this.prisma.bankTransaction.updateMany({
      where: {
        bankAccountId: reconciliation.bankAccountId,
        transactionDate: { lte: reconciliation.periodEnd },
        status: TransactionStatus.CLEARED,
      },
      data: { status: TransactionStatus.PENDING },
    });

    await this.prisma.bankReconciliation.update({
      where: { id },
      data: { status: ReconciliationStatus.ABANDONED },
    });

    return this.findById(organizationId, id);
  }

  async getHistory(organizationId: string, bankAccountId: string) {
    return this.prisma.bankReconciliation.findMany({
      where: {
        bankAccountId,
        bankAccount: { organizationId },
      },
      orderBy: { periodEnd: 'desc' },
      take: 24, // Last 2 years of monthly statements
    });
  }

  private async updateReconciliationTotals(reconciliationId: string) {
    const reconciliation = await this.prisma.bankReconciliation.findUnique({
      where: { id: reconciliationId },
    });

    if (!reconciliation) return;

    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        bankAccountId: reconciliation.bankAccountId,
        transactionDate: { lte: reconciliation.periodEnd },
        status: TransactionStatus.CLEARED,
      },
    });

    const beginningBalance = parseFloat(reconciliation.beginningBalance.toString());
    const statementEndingBalance = parseFloat(reconciliation.statementBalance.toString());

    let clearedBalance = beginningBalance;
    for (const txn of transactions) {
      const amount = parseFloat(txn.amount.toString());
      if (isInflow(txn.transactionType)) {
        clearedBalance += amount;
      } else {
        clearedBalance -= amount;
      }
    }

    await this.prisma.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        clearedBalance,
        difference: statementEndingBalance - clearedBalance,
      },
    });
  }
}
