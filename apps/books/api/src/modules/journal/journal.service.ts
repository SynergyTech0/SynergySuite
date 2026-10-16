import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountService } from '../account/account.service';
import { FiscalPeriodService } from '../fiscal-period/fiscal-period.service';
import {
  CreateJournalDto,
  UpdateJournalDto,
  JournalSearchDto,
  JournalStatus,
  JournalSource,
} from './dto/journal.dto';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';

const journalListInclude = Prisma.validator<Prisma.JournalInclude>()({
  lines: {
    include: {
      account: {
        select: { id: true, accountNumber: true, name: true, accountType: true },
      },
    },
    orderBy: { lineNumber: 'asc' },
  },
  period: {
    select: { id: true, name: true },
  },
});

const journalDetailInclude = Prisma.validator<Prisma.JournalInclude>()({
  lines: {
    include: {
      account: {
        select: {
          id: true,
          accountNumber: true,
          name: true,
          accountType: true,
          normalBalance: true,
        },
      },
      taxClassification: {
        include: {
          citations: true,
        },
      },
    },
    orderBy: { lineNumber: 'asc' },
  },
  period: true,
});

type ResponseLine = {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  account: { accountNumber: string; accountType: string };
};

type ResponseJournal<L extends ResponseLine, P> = {
  journalNumber: string;
  journalDate: Date;
  sourceType: string;
  periodId: string | null;
  period: P;
  lines: L[];
};

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
    private readonly fiscalPeriodService: FiscalPeriodService,
    @InjectQueue('tax-classification') private readonly taxQueue: Queue,
  ) {}

  async create(organizationId: string, dto: CreateJournalDto, createdBy?: string) {
    // Validate the journal entry
    await this.validateJournalEntry(organizationId, dto);

    // Generate entry number
    const entryNumber = await this.generateEntryNumber(organizationId, dto.type);

    // Determine fiscal period
    let fiscalPeriodId = dto.fiscalPeriodId;
    if (!fiscalPeriodId) {
      const period = await this.fiscalPeriodService.findByDate(
        organizationId,
        new Date(dto.date),
      );
      fiscalPeriodId = period?.id;
    }

    // Create journal with lines in a transaction
    const journal = await this.prisma.$transaction(async (tx) => {
      const journalId = uuidv4();

      // Create journal header
      const journal = await tx.journal.create({
        data: {
          id: journalId,
          organizationId,
          journalNumber: entryNumber,
          journalDate: new Date(dto.date),
          type: dto.type,
          sourceType: dto.source || JournalSource.MANUAL,
          status: JournalStatus.DRAFT,
          reference: dto.reference,
          description: dto.description,
          periodId: fiscalPeriodId,
          tags: dto.tags || [],
          createdBy,
        },
      });

      // Create journal lines
      for (let i = 0; i < dto.lines.length; i++) {
        const line = dto.lines[i];
        await tx.journalLine.create({
          data: {
            id: uuidv4(),
            journalId,
            lineNumber: i + 1,
            accountId: line.accountId,
            debit: new Decimal(line.debit || 0),
            credit: new Decimal(line.credit || 0),
            description: line.description,
            referenceType: line.referenceType,
            referenceId: line.referenceId,
            taxCode: line.taxCode,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          },
        });
      }

      return journal;
    });

    // Queue tax classification job
    await this.taxQueue.add('classify-journal', {
      journalId: journal.id,
      organizationId,
    });

    return this.findById(organizationId, journal.id);
  }

  async findAll(organizationId: string, search: JournalSearchDto, pagination: { skip?: number; take?: number } = {}) {
    const { skip = 0, take = 50 } = pagination;

    const where: Prisma.JournalWhereInput = { organizationId };

    if (search.startDate || search.endDate) {
      where.journalDate = {
        ...(search.startDate ? { gte: new Date(search.startDate) } : {}),
        ...(search.endDate ? { lte: new Date(search.endDate) } : {}),
      };
    }
    if (search.type) {
      where.type = search.type;
    }
    if (search.status) {
      where.status = search.status;
    }
    if (search.source) {
      where.sourceType = search.source;
    }
    if (search.fiscalPeriodId) {
      where.periodId = search.fiscalPeriodId;
    }
    if (search.tags && search.tags.length > 0) {
      where.tags = { hasSome: search.tags };
    }
    if (search.search) {
      where.OR = [
        { description: { contains: search.search, mode: 'insensitive' } },
        { reference: { contains: search.search, mode: 'insensitive' } },
        { journalNumber: { contains: search.search, mode: 'insensitive' } },
      ];
    }
    if (search.accountId) {
      where.lines = { some: { accountId: search.accountId } };
    }

    const [items, total] = await Promise.all([
      this.prisma.journal.findMany({
        where,
        include: journalListInclude,
        orderBy: [{ journalDate: 'desc' }, { journalNumber: 'desc' }],
        skip,
        take,
      }),
      this.prisma.journal.count({ where }),
    ]);

    // Calculate totals for each journal
    const itemsWithTotals = items.map((journal) => this.toJournalResponse(journal));

    return {
      items: itemsWithTotals,
      total,
      page: Math.floor(skip / take) + 1,
      pageSize: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async findById(organizationId: string, id: string) {
    const journal = await this.prisma.journal.findFirst({
      where: { id, organizationId },
      include: journalDetailInclude,
    });

    if (!journal) {
      throw new NotFoundException(`Journal entry ${id} not found`);
    }

    // Reversal links are stored as plain ids on Journal (no relation)
    const [reversalOf, reversedBy] = await Promise.all([
      journal.reversesJournalId
        ? this.prisma.journal.findUnique({
            where: { id: journal.reversesJournalId },
            select: { id: true, journalNumber: true },
          })
        : null,
      journal.reversedByJournalId
        ? this.prisma.journal.findUnique({
            where: { id: journal.reversedByJournalId },
            select: { id: true, journalNumber: true },
          })
        : null,
    ]);

    return {
      ...this.toJournalResponse(journal),
      reversalOf: reversalOf
        ? { id: reversalOf.id, entryNumber: reversalOf.journalNumber }
        : null,
      reversedBy: reversedBy
        ? { id: reversedBy.id, entryNumber: reversedBy.journalNumber }
        : null,
    };
  }

  /**
   * Add debit/credit totals and the legacy response keys (entryNumber, date,
   * source, fiscalPeriodId, fiscalPeriod, account.code/type) to a journal.
   */
  private toJournalResponse<L extends ResponseLine, P, J extends ResponseJournal<L, P>>(
    journal: J,
  ) {
    const totalDebit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const totalCredit = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);

    return {
      ...journal,
      entryNumber: journal.journalNumber,
      date: journal.journalDate,
      source: journal.sourceType,
      fiscalPeriodId: journal.periodId,
      fiscalPeriod: journal.period,
      lines: journal.lines.map((line) => ({
        ...line,
        account: {
          ...line.account,
          code: line.account.accountNumber,
          type: line.account.accountType,
        },
      })),
      totalDebit,
      totalCredit,
    };
  }

  async update(organizationId: string, id: string, dto: UpdateJournalDto) {
    const journal = await this.findById(organizationId, id);

    if (journal.status === JournalStatus.POSTED) {
      throw new BadRequestException('Cannot modify posted journal entries');
    }
    if (journal.status === JournalStatus.VOIDED) {
      throw new BadRequestException('Cannot modify voided journal entries');
    }

    // Validate if lines are being updated
    if (dto.lines) {
      await this.validateJournalEntry(organizationId, {
        date: dto.date || journal.journalDate.toISOString(),
        type: journal.type,
        lines: dto.lines,
      } as CreateJournalDto);
    }

    // Determine fiscal period if date changed
    let fiscalPeriodId = journal.periodId;
    if (dto.date) {
      const period = await this.fiscalPeriodService.findByDate(
        organizationId,
        new Date(dto.date),
      );
      fiscalPeriodId = period?.id ?? null;
    }

    await this.prisma.$transaction(async (tx) => {
      // Update header
      await tx.journal.update({
        where: { id },
        data: {
          journalDate: dto.date ? new Date(dto.date) : undefined,
          reference: dto.reference,
          description: dto.description,
          periodId: fiscalPeriodId,
          tags: dto.tags,
        },
      });

      // Update lines if provided
      if (dto.lines) {
        // Delete existing lines
        await tx.journalLine.deleteMany({ where: { journalId: id } });

        // Create new lines
        for (let i = 0; i < dto.lines.length; i++) {
          const line = dto.lines[i];
          await tx.journalLine.create({
            data: {
              id: uuidv4(),
              journalId: id,
              lineNumber: i + 1,
              accountId: line.accountId,
              debit: new Decimal(line.debit || 0),
              credit: new Decimal(line.credit || 0),
              description: line.description,
              referenceType: line.referenceType,
              referenceId: line.referenceId,
              taxCode: line.taxCode,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            },
          });
        }

        // Re-queue tax classification
        await this.taxQueue.add('classify-journal', {
          journalId: id,
          organizationId,
        });
      }
    });

    // Read back after commit so the result reflects the updated lines
    return this.findById(organizationId, id);
  }

  async post(organizationId: string, id: string, postDate?: Date) {
    const journal = await this.findById(organizationId, id);

    if (journal.status === JournalStatus.POSTED) {
      throw new BadRequestException('Journal entry is already posted');
    }
    if (journal.status === JournalStatus.VOIDED) {
      throw new BadRequestException('Cannot post voided journal entry');
    }

    // Check fiscal period is open
    if (journal.periodId) {
      const period = await this.prisma.fiscalPeriod.findUnique({
        where: { id: journal.periodId },
      });
      if (period && period.status !== 'OPEN') {
        throw new BadRequestException(
          `Cannot post to ${period.status.toLowerCase()} fiscal period`,
        );
      }
    }

    return this.prisma.journal.update({
      where: { id },
      data: {
        status: JournalStatus.POSTED,
        postedAt: postDate || new Date(),
      },
    });
  }

  async void(organizationId: string, id: string, reason: string, voidedBy?: string) {
    const journal = await this.findById(organizationId, id);

    if (journal.status === JournalStatus.VOIDED) {
      throw new BadRequestException('Journal entry is already voided');
    }

    // Check fiscal period allows modifications
    if (journal.periodId) {
      const period = await this.prisma.fiscalPeriod.findUnique({
        where: { id: journal.periodId },
      });
      if (period && period.status === 'CLOSED') {
        throw new BadRequestException('Cannot void entries in closed fiscal period');
      }
    }

    return this.prisma.journal.update({
      where: { id },
      data: {
        status: JournalStatus.VOIDED,
        voidedAt: new Date(),
        voidReason: reason,
        voidedBy,
      },
    });
  }

  async reverse(
    organizationId: string,
    id: string,
    reversalDate: Date,
    reason?: string,
    createdBy?: string,
  ) {
    const journal = await this.findById(organizationId, id);

    if (journal.status !== JournalStatus.POSTED) {
      throw new BadRequestException('Can only reverse posted journal entries');
    }
    if (journal.reversedByJournalId) {
      throw new BadRequestException('Journal entry has already been reversed');
    }

    // Create reversal entry
    // Swap debits and credits on every line
    const reversalLines = journal.lines.map((line) => ({
      accountId: line.accountId,
      debit: Number(line.credit),
      credit: Number(line.debit),
      description: `Reversal: ${line.description || ''}`,
    }));

    // Create and post reversal in transaction
    const reversalId = await this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.generateEntryNumber(organizationId, 'REVERSING');
      const period = await this.fiscalPeriodService.findByDate(organizationId, reversalDate);

      const reversalId = uuidv4();

      // Create reversal journal
      await tx.journal.create({
        data: {
          id: reversalId,
          organizationId,
          journalNumber: entryNumber,
          journalDate: reversalDate,
          type: 'REVERSING',
          sourceType: journal.sourceType,
          status: JournalStatus.POSTED,
          reference: `REV-${journal.journalNumber}`,
          description: reason || `Reversal of ${journal.journalNumber}`,
          periodId: period?.id,
          reversesJournalId: id,
          isReversing: true,
          postedAt: new Date(),
          createdBy,
        },
      });

      // Create reversal lines
      for (let i = 0; i < reversalLines.length; i++) {
        const line = reversalLines[i];
        await tx.journalLine.create({
          data: {
            id: uuidv4(),
            journalId: reversalId,
            lineNumber: i + 1,
            accountId: line.accountId,
            debit: new Decimal(line.debit || 0),
            credit: new Decimal(line.credit || 0),
            description: line.description,
          },
        });
      }

      // Update original journal
      await tx.journal.update({
        where: { id },
        data: { reversedByJournalId: reversalId },
      });

      return reversalId;
    });

    // Read back after commit so the new reversal entry is visible
    return this.findById(organizationId, reversalId);
  }

  async delete(organizationId: string, id: string) {
    const journal = await this.findById(organizationId, id);

    if (journal.status === JournalStatus.POSTED) {
      throw new BadRequestException('Cannot delete posted journal entries. Void instead.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { journalId: id } });
      await tx.journal.delete({ where: { id } });
    });
  }

  async getAccountLedger(
    organizationId: string,
    accountId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      fiscalPeriodId?: string;
    } = {},
  ) {
    const { startDate, endDate, fiscalPeriodId } = options;

    // Verify account exists
    await this.accountService.findById(organizationId, accountId);

    const journalWhere: Prisma.JournalWhereInput = {
      organizationId,
      status: JournalStatus.POSTED,
    };

    if (startDate || endDate) {
      journalWhere.journalDate = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
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
      include: {
        journal: {
          select: {
            id: true,
            journalNumber: true,
            journalDate: true,
            description: true,
            reference: true,
          },
        },
      },
      orderBy: [
        { journal: { journalDate: 'asc' } },
        { journal: { journalNumber: 'asc' } },
        { lineNumber: 'asc' },
      ],
    });

    // Calculate running balance
    let runningBalance = new Decimal(0);
    const ledgerEntries = lines.map((line) => {
      const debit = line.debit ? new Decimal(line.debit.toString()) : new Decimal(0);
      const credit = line.credit ? new Decimal(line.credit.toString()) : new Decimal(0);
      runningBalance = runningBalance.plus(debit).minus(credit);

      return {
        date: line.journal.journalDate,
        entryNumber: line.journal.journalNumber,
        journalId: line.journal.id,
        description: line.description || line.journal.description,
        reference: line.journal.reference,
        debit: debit.toNumber(),
        credit: credit.toNumber(),
        balance: runningBalance.toNumber(),
      };
    });

    return {
      accountId,
      entries: ledgerEntries,
      totalDebits: ledgerEntries.reduce((sum, e) => sum + e.debit, 0),
      totalCredits: ledgerEntries.reduce((sum, e) => sum + e.credit, 0),
      endingBalance: runningBalance.toNumber(),
    };
  }

  private async validateJournalEntry(organizationId: string, dto: CreateJournalDto) {
    // Validate all accounts exist and belong to organization
    const accountIds = dto.lines.map((l) => l.accountId);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, organizationId },
    });

    if (accounts.length !== accountIds.length) {
      const foundIds = accounts.map((a) => a.id);
      const missingIds = accountIds.filter((id) => !foundIds.includes(id));
      throw new BadRequestException(`Accounts not found: ${missingIds.join(', ')}`);
    }

    // Check accounts are active
    const inactiveAccounts = accounts.filter((a) => !a.isActive);
    if (inactiveAccounts.length > 0) {
      throw new BadRequestException(
        `Inactive accounts: ${inactiveAccounts.map((a) => a.accountNumber).join(', ')}`,
      );
    }

    // Validate each line has either debit or credit (not both, not neither)
    for (const line of dto.lines) {
      const hasDebit = line.debit !== undefined && line.debit > 0;
      const hasCredit = line.credit !== undefined && line.credit > 0;

      if (hasDebit && hasCredit) {
        throw new BadRequestException('Line cannot have both debit and credit');
      }
      if (!hasDebit && !hasCredit) {
        throw new BadRequestException('Line must have either debit or credit');
      }
    }

    // Validate debits equal credits
    const totalDebits = dto.lines.reduce(
      (sum, l) => sum + (l.debit || 0),
      0,
    );
    const totalCredits = dto.lines.reduce(
      (sum, l) => sum + (l.credit || 0),
      0,
    );

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      throw new BadRequestException(
        `Journal entry is unbalanced. Debits: ${totalDebits}, Credits: ${totalCredits}`,
      );
    }

    return true;
  }

  private async generateEntryNumber(organizationId: string, type: string): Promise<string> {
    const prefix = this.getEntryPrefix(type);
    const year = new Date().getFullYear();

    // Get the last entry number for this type and year
    const lastEntry = await this.prisma.journal.findFirst({
      where: {
        organizationId,
        journalNumber: { startsWith: `${prefix}-${year}-` },
      },
      orderBy: { journalNumber: 'desc' },
    });

    let sequence = 1;
    if (lastEntry) {
      const parts = lastEntry.journalNumber.split('-');
      sequence = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `${prefix}-${year}-${sequence.toString().padStart(6, '0')}`;
  }

  private getEntryPrefix(type: string): string {
    const prefixes: Record<string, string> = {
      GENERAL: 'GJ',
      ADJUSTING: 'AJ',
      CLOSING: 'CL',
      REVERSING: 'RV',
      RECURRING: 'RC',
    };
    return prefixes[type] || 'JE';
  }
}
