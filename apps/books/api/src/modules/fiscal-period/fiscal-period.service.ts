import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFiscalPeriodDto,
  UpdateFiscalPeriodDto,
  GenerateFiscalPeriodsDto,
  PeriodType,
  PeriodStatus,
} from './dto/fiscal-period.dto';
import { v4 as uuidv4 } from 'uuid';
import {
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  addMonths,
  addQuarters,
  format,
  isAfter,
  isBefore,
  isWithinInterval,
} from 'date-fns';

@Injectable()
export class FiscalPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateFiscalPeriodDto) {
    // Validate organization exists
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    // Validate date range
    if (isAfter(startDate, endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Check for overlapping periods
    const overlapping = await this.findOverlappingPeriods(
      organizationId,
      startDate,
      endDate,
    );
    if (overlapping.length > 0) {
      throw new ConflictException(
        `Period overlaps with existing period: ${overlapping[0].name}`,
      );
    }

    return this.prisma.fiscalPeriod.create({
      data: {
        id: uuidv4(),
        organizationId,
        name: dto.name,
        periodType: dto.type,
        startDate,
        endDate,
        status: dto.status || PeriodStatus.FUTURE,
        fiscalYear: this.parseFiscalYear(dto.fiscalYear),
        periodNumber: dto.periodNumber,
      },
    });
  }

  async findAll(
    organizationId: string,
    options: {
      fiscalYear?: string;
      status?: PeriodStatus;
      type?: PeriodType;
    } = {},
  ) {
    const { fiscalYear, status, type } = options;

    const where: Prisma.FiscalPeriodWhereInput = { organizationId };
    if (fiscalYear) where.fiscalYear = this.parseFiscalYear(fiscalYear);
    if (status) where.status = status;
    if (type) where.periodType = type;

    return this.prisma.fiscalPeriod.findMany({
      where,
      orderBy: [{ fiscalYear: 'desc' }, { periodNumber: 'asc' }, { startDate: 'asc' }],
    });
  }

  async findById(organizationId: string, id: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id, organizationId },
    });

    if (!period) {
      throw new NotFoundException(`Fiscal period ${id} not found`);
    }

    return period;
  }

  async findByDate(organizationId: string, date: Date) {
    return this.prisma.fiscalPeriod.findFirst({
      where: {
        organizationId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
  }

  async findCurrentPeriod(organizationId: string) {
    return this.prisma.fiscalPeriod.findFirst({
      where: {
        organizationId,
        status: PeriodStatus.OPEN,
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateFiscalPeriodDto) {
    const period = await this.findById(organizationId, id);

    // Validate status transitions
    if (dto.status) {
      this.validateStatusTransition(period.status as PeriodStatus, dto.status);
    }

    return this.prisma.fiscalPeriod.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
      },
    });
  }

  async close(organizationId: string, id: string) {
    const period = await this.findById(organizationId, id);

    if (period.status === PeriodStatus.CLOSED) {
      throw new BadRequestException('Period is already closed');
    }
    if (period.status === PeriodStatus.LOCKED) {
      throw new BadRequestException('Period is locked');
    }
    if (period.status === PeriodStatus.FUTURE) {
      throw new BadRequestException('Cannot close future period');
    }

    // Check for unposted entries in this period
    const unpostedCount = await this.prisma.journal.count({
      where: {
        organizationId,
        periodId: id,
        status: { notIn: ['POSTED', 'VOIDED'] },
      },
    });

    if (unpostedCount > 0) {
      throw new BadRequestException(
        `Cannot close period with ${unpostedCount} unposted journal entries`,
      );
    }

    return this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: PeriodStatus.CLOSED },
    });
  }

  async reopen(organizationId: string, id: string) {
    const period = await this.findById(organizationId, id);

    if (period.status === PeriodStatus.OPEN) {
      throw new BadRequestException('Period is already open');
    }
    if (period.status === PeriodStatus.LOCKED) {
      throw new BadRequestException('Cannot reopen locked period');
    }
    if (period.status === PeriodStatus.FUTURE) {
      throw new BadRequestException('Cannot reopen future period');
    }

    return this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: PeriodStatus.OPEN },
    });
  }

  async lock(organizationId: string, id: string) {
    const period = await this.findById(organizationId, id);

    if (period.status === PeriodStatus.LOCKED) {
      throw new BadRequestException('Period is already locked');
    }
    if (period.status !== PeriodStatus.CLOSED) {
      throw new BadRequestException('Period must be closed before locking');
    }

    return this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: PeriodStatus.LOCKED },
    });
  }

  async generatePeriods(organizationId: string, dto: GenerateFiscalPeriodsDto) {
    const startDate = new Date(dto.startDate);
    const fiscalYear =
      this.parseFiscalYear(dto.fiscalYear) ?? Number(format(startDate, 'yyyy'));

    const periods: Array<
      Omit<Prisma.FiscalPeriodUncheckedCreateInput, 'id' | 'organizationId'>
    > = [];

    if (dto.periodType === PeriodType.MONTH) {
      // Generate 12 monthly periods
      for (let i = 0; i < 12; i++) {
        const periodStart = startOfMonth(addMonths(startDate, i));
        const periodEnd = endOfMonth(addMonths(startDate, i));

        periods.push({
          name: format(periodStart, 'MMMM yyyy'),
          periodType: PeriodType.MONTH,
          startDate: periodStart,
          endDate: periodEnd,
          fiscalYear,
          periodNumber: i + 1,
          status: i === 0 ? PeriodStatus.OPEN : PeriodStatus.FUTURE,
        });
      }
    } else if (dto.periodType === PeriodType.QUARTER) {
      // Generate 4 quarterly periods
      for (let i = 0; i < 4; i++) {
        const periodStart = startOfQuarter(addQuarters(startDate, i));
        const periodEnd = endOfQuarter(addQuarters(startDate, i));

        periods.push({
          name: `Q${i + 1} ${fiscalYear}`,
          periodType: PeriodType.QUARTER,
          startDate: periodStart,
          endDate: periodEnd,
          fiscalYear,
          periodNumber: i + 1,
          status: i === 0 ? PeriodStatus.OPEN : PeriodStatus.FUTURE,
        });
      }
    } else if (dto.periodType === PeriodType.YEAR) {
      // Generate single annual period
      const endDate = endOfMonth(addMonths(startDate, 11));
      periods.push({
        name: `FY ${fiscalYear}`,
        periodType: PeriodType.YEAR,
        startDate,
        endDate,
        fiscalYear,
        periodNumber: 1,
        status: PeriodStatus.OPEN,
      });
    }

    // Check for existing periods in this fiscal year
    const existing = await this.prisma.fiscalPeriod.findFirst({
      where: { organizationId, fiscalYear },
    });
    if (existing) {
      throw new ConflictException(
        `Periods for fiscal year ${fiscalYear} already exist`,
      );
    }

    // Create all periods
    const created = await this.prisma.$transaction(
      periods.map((period) =>
        this.prisma.fiscalPeriod.create({
          data: {
            id: uuidv4(),
            organizationId,
            ...period,
          },
        }),
      ),
    );

    return created;
  }

  async delete(organizationId: string, id: string) {
    const period = await this.findById(organizationId, id);

    // Check for entries in this period
    const entryCount = await this.prisma.journal.count({
      where: { periodId: id },
    });

    if (entryCount > 0) {
      throw new BadRequestException(
        `Cannot delete period with ${entryCount} journal entries`,
      );
    }

    return this.prisma.fiscalPeriod.delete({ where: { id } });
  }

  /** FiscalPeriod.fiscalYear is an Int; the DTOs accept it as a string. */
  private parseFiscalYear(value?: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const year = Number.parseInt(String(value).replace(/\D/g, ''), 10);
    if (Number.isNaN(year)) {
      throw new BadRequestException(`Invalid fiscal year: ${value}`);
    }
    return year;
  }

  private async findOverlappingPeriods(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ) {
    const where: any = {
      organizationId,
      OR: [
        {
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      ],
    };

    if (excludeId) {
      where.id = { not: excludeId };
    }

    return this.prisma.fiscalPeriod.findMany({ where });
  }

  private validateStatusTransition(
    currentStatus: PeriodStatus,
    newStatus: PeriodStatus,
  ) {
    const validTransitions: Record<PeriodStatus, PeriodStatus[]> = {
      [PeriodStatus.FUTURE]: [PeriodStatus.OPEN],
      [PeriodStatus.OPEN]: [PeriodStatus.CLOSED],
      [PeriodStatus.CLOSED]: [PeriodStatus.OPEN, PeriodStatus.LOCKED],
      [PeriodStatus.LOCKED]: [],
    };

    if (!(validTransitions[currentStatus] ?? []).includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }
}
