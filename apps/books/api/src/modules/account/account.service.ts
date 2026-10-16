import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto, AccountType } from './dto/account.dto';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateAccountDto) {
    // Verify organization exists
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    // Check for duplicate code in organization
    const existing = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Account with code ${dto.code} already exists in this organization`,
      );
    }

    // Validate parent if provided
    if (dto.parentId) {
      const parent = await this.prisma.account.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) {
        throw new NotFoundException(`Parent account ${dto.parentId} not found`);
      }
      if (parent.accountType !== dto.type) {
        throw new BadRequestException(
          'Child account must have the same type as parent account',
        );
      }
    }

    return this.prisma.account.create({
      data: {
        id: uuidv4(),
        organizationId,
        accountNumber: dto.code,
        name: dto.name,
        description: dto.description,
        accountType: dto.type,
        accountSubtype: dto.subType,
        normalBalance: dto.normalBalance,
        parentId: dto.parentId,
        taxCode: dto.taxCode,
        isBankAccount: dto.isBankAccount || false,
        currency: dto.currency || org.defaultCurrency,
        isSystemAccount: false,
        isActive: true,
      },
    });
  }

  async findAll(
    organizationId: string,
    options: {
      type?: AccountType;
      isActive?: boolean;
      parentId?: string | null;
      search?: string;
    } = {},
  ) {
    const { type, isActive, parentId, search } = options;

    const where: Prisma.AccountWhereInput = { organizationId };

    if (type) where.accountType = type;
    if (isActive !== undefined) where.isActive = isActive;
    if (parentId !== undefined) where.parentId = parentId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { accountNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.account.findMany({
      where,
      include: {
        parent: {
          select: { id: true, accountNumber: true, name: true },
        },
        children: {
          select: { id: true, accountNumber: true, name: true },
          where: { isActive: true },
        },
      },
      orderBy: { accountNumber: 'asc' },
    });
  }

  async findById(organizationId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, organizationId },
      include: {
        parent: true,
        children: {
          where: { isActive: true },
          orderBy: { accountNumber: 'asc' },
        },
      },
    });

    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }

    return account;
  }

  async findByCode(organizationId: string, code: string) {
    const account = await this.prisma.account.findFirst({
      where: { accountNumber: code, organizationId },
    });

    if (!account) {
      throw new NotFoundException(`Account with code ${code} not found`);
    }

    return account;
  }

  async update(organizationId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.findById(organizationId, id);

    if (account.isSystemAccount && dto.isActive === false) {
      throw new BadRequestException('Cannot deactivate system accounts');
    }

    // Validate parent if being updated
    if (dto.parentId && dto.parentId !== account.parentId) {
      const parent = await this.prisma.account.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) {
        throw new NotFoundException(`Parent account ${dto.parentId} not found`);
      }
      if (parent.accountType !== account.accountType) {
        throw new BadRequestException(
          'Child account must have the same type as parent account',
        );
      }
      // Prevent circular references
      if (await this.wouldCreateCircularReference(id, dto.parentId)) {
        throw new BadRequestException('Cannot create circular parent reference');
      }
    }

    return this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        accountSubtype: dto.subType,
        parentId: dto.parentId,
        taxCode: dto.taxCode,
        isBankAccount: dto.isBankAccount,
        isActive: dto.isActive,
      },
    });
  }

  async delete(organizationId: string, id: string) {
    const account = await this.findById(organizationId, id);

    if (account.isSystemAccount) {
      throw new BadRequestException('Cannot delete system accounts');
    }

    // Check if account has children
    if (account.children && account.children.length > 0) {
      throw new BadRequestException(
        'Cannot delete account with child accounts. Delete children first.',
      );
    }

    // Check if account has transactions
    const lineCount = await this.prisma.journalLine.count({
      where: { accountId: id },
    });
    if (lineCount > 0) {
      throw new BadRequestException(
        'Cannot delete account with transactions. Deactivate instead.',
      );
    }

    return this.prisma.account.delete({ where: { id } });
  }

  async getBalance(
    organizationId: string,
    accountId: string,
    options: {
      asOfDate?: Date;
      fiscalPeriodId?: string;
    } = {},
  ) {
    const account = await this.findById(organizationId, accountId);
    const { asOfDate, fiscalPeriodId } = options;

    const journalWhere: Prisma.JournalWhereInput = {
      organizationId,
      status: 'POSTED',
    };

    if (asOfDate) {
      journalWhere.journalDate = { lte: asOfDate };
    }

    if (fiscalPeriodId) {
      journalWhere.periodId = fiscalPeriodId;
    }

    const where: Prisma.JournalLineWhereInput = {
      accountId,
      journal: journalWhere,
    };

    const lines = await this.prisma.journalLine.findMany({
      where,
      select: {
        debit: true,
        credit: true,
      },
    });

    let debitTotal = new Decimal(0);
    let creditTotal = new Decimal(0);

    for (const line of lines) {
      if (line.debit) debitTotal = debitTotal.plus(line.debit.toString());
      if (line.credit) creditTotal = creditTotal.plus(line.credit.toString());
    }

    // Calculate balance based on normal balance
    let balance: Decimal;
    if (account.normalBalance === 'DEBIT') {
      balance = debitTotal.minus(creditTotal);
    } else {
      balance = creditTotal.minus(debitTotal);
    }

    return {
      accountId: account.id,
      accountCode: account.accountNumber,
      accountNumber: account.accountNumber,
      accountName: account.name,
      accountType: account.accountType,
      debitBalance: debitTotal.toNumber(),
      creditBalance: creditTotal.toNumber(),
      balance: balance.toNumber(),
      normalBalance: account.normalBalance,
    };
  }

  async getTrialBalance(
    organizationId: string,
    options: {
      asOfDate?: Date;
      fiscalPeriodId?: string;
    } = {},
  ) {
    const accounts = await this.findAll(organizationId, { isActive: true });

    const balances = await Promise.all(
      accounts.map((account) =>
        this.getBalance(organizationId, account.id, options),
      ),
    );

    // Filter out zero balances
    const nonZeroBalances = balances.filter(
      (b) => b.debitBalance !== 0 || b.creditBalance !== 0,
    );

    const totalDebits = nonZeroBalances.reduce(
      (sum, b) => sum + b.debitBalance,
      0,
    );
    const totalCredits = nonZeroBalances.reduce(
      (sum, b) => sum + b.creditBalance,
      0,
    );

    return {
      accounts: nonZeroBalances,
      totalDebits,
      totalCredits,
      isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
    };
  }

  async getChartOfAccounts(organizationId: string) {
    const accounts = await this.findAll(organizationId, {
      isActive: true,
      parentId: null,
    });

    // Build hierarchical structure
    const buildTree = async (parentId: string | null): Promise<any[]> => {
      const children = await this.prisma.account.findMany({
        where: { organizationId, parentId, isActive: true },
        orderBy: { accountNumber: 'asc' },
      });

      return Promise.all(
        children.map(async (account) => ({
          ...account,
          children: await buildTree(account.id),
        })),
      );
    };

    return buildTree(null);
  }

  private async wouldCreateCircularReference(
    accountId: string,
    newParentId: string,
  ): Promise<boolean> {
    let currentId: string | null = newParentId;

    while (currentId) {
      if (currentId === accountId) {
        return true;
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.account.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
      currentId = parent?.parentId || null;
    }

    return false;
  }
}
