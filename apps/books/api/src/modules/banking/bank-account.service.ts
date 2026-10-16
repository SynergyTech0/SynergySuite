import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/banking.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BankAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateBankAccountDto) {
    // Verify GL account exists and is a bank account
    const glAccount = await this.prisma.account.findFirst({
      where: { id: dto.glAccountId, organizationId },
    });

    if (!glAccount) {
      throw new NotFoundException(`GL Account ${dto.glAccountId} not found`);
    }

    return this.prisma.bankAccount.create({
      data: {
        id: uuidv4(),
        organizationId,
        accountName: dto.name,
        accountType: dto.accountType,
        bankName: dto.bankName ?? '',
        accountNumber: dto.accountNumberLast4 ?? '',
        routingNumber: dto.routingNumber,
        accountId: dto.glAccountId,
        currentBalance: dto.openingBalance || 0,
        currency: dto.currency || 'USD',
        isActive: true,
        lastSyncAt: null,
      },
    });
  }

  async findAll(organizationId: string, options: { isActive?: boolean } = {}) {
    const where: any = { organizationId };
    if (options.isActive !== undefined) where.isActive = options.isActive;

    return this.prisma.bankAccount.findMany({
      where,
      include: {
        glAccount: { select: { id: true, accountNumber: true, name: true } },
        _count: { select: { transactions: true } },
      },
      orderBy: { accountName: 'asc' },
    });
  }

  async findById(organizationId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, organizationId },
      include: {
        glAccount: true,
        transactions: {
          orderBy: { transactionDate: 'desc' },
          take: 20,
        },
        reconciliations: {
          orderBy: { periodEnd: 'desc' },
          take: 5,
        },
      },
    });

    if (!account) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    return account;
  }

  async update(organizationId: string, id: string, dto: UpdateBankAccountDto) {
    await this.findById(organizationId, id);

    return this.prisma.bankAccount.update({
      where: { id },
      data: {
        accountName: dto.name,
        bankName: dto.bankName,
        isActive: dto.isActive,
      },
    });
  }

  async updateBalance(bankAccountId: string) {
    const transactions = await this.prisma.bankTransaction.findMany({
      where: { bankAccountId, status: { not: 'EXCLUDED' } },
    });

    let balance = 0;
    for (const txn of transactions) {
      // CREDIT/DEPOSIT = money into the account; everything else reduces it.
      if (txn.transactionType === 'CREDIT' || txn.transactionType === 'DEPOSIT') {
        balance += parseFloat(txn.amount.toString());
      } else {
        balance -= parseFloat(txn.amount.toString());
      }
    }

    await this.prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { currentBalance: balance },
    });

    return balance;
  }

  async getAccountSummary(organizationId: string) {
    const accounts = await this.findAll(organizationId, { isActive: true });

    const summary = {
      totalCash: 0,
      totalCreditCardDebt: 0,
      accounts: accounts.map((acc) => ({
        id: acc.id,
        name: acc.accountName,
        type: acc.accountType,
        balance: acc.currentBalance,
        lastSynced: acc.lastSyncAt,
      })),
    };

    for (const acc of accounts) {
      if (acc.accountType === 'CREDIT_CARD' || acc.accountType === 'LINE_OF_CREDIT') {
        summary.totalCreditCardDebt += parseFloat(acc.currentBalance.toString());
      } else {
        summary.totalCash += parseFloat(acc.currentBalance.toString());
      }
    }

    return summary;
  }
}
