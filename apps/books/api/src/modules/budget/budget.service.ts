import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BudgetPeriodKind,
  ForecastMethod,
  Period,
  actualsByPeriod,
  budgetPeriods,
  closedPeriods,
  fiscalYearEndDate,
  fiscalYearStart,
  forecastLine,
  isFavorable,
  planFor,
  round2,
  sum,
  variancePercent,
} from './budget-math';
import { BudgetFromActualsDto, BudgetLineItemDto, CreateBudgetDto, UpdateBudgetDto } from './budget.dto';

export { CreateBudgetDto } from './budget.dto';

const lineInclude = { lineItems: { include: { account: true }, orderBy: { account: { accountNumber: 'asc' } } } } as const;
type BudgetWithLines = Prisma.BudgetGetPayload<{ include: typeof lineInclude }>;

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- Plan ----------------------------------------------------------------

  async createBudget(organizationId: string, dto: CreateBudgetDto) {
    const { start, end } = await this.range(organizationId, dto.fiscalYear, dto.startDate, dto.endDate);
    const periods = budgetPeriods(start, end, dto.period);
    await this.checkDimensions(organizationId, dto.classId, dto.locationId);
    const lines = await this.planLines(organizationId, periods.length, dto.lineItems ?? []);
    await this.ensureUniqueName(organizationId, dto.budgetName, dto.fiscalYear);

    const budget = await this.prisma.budget.create({
      data: {
        organizationId,
        budgetName: dto.budgetName,
        fiscalYear: dto.fiscalYear,
        period: dto.period,
        startDate: start,
        endDate: end,
        status: 'DRAFT',
        classId: dto.classId || null,
        locationId: dto.locationId || null,
        notes: dto.notes,
        lineItems: { createMany: { data: lines } },
      },
      include: lineInclude,
    });

    this.logger.log(`Budget ${dto.budgetName} created for fiscal year ${dto.fiscalYear}`);
    return this.present(budget);
  }

  /**
   * Starts a budget from what actually happened in an earlier year: each account's actuals,
   * period by period, scaled by a growth percent. Accounts with no activity are left out.
   */
  async createFromActuals(organizationId: string, dto: BudgetFromActualsDto) {
    const org = await this.org(organizationId);
    const sourceYear = dto.sourceYear ?? dto.fiscalYear - 1;
    const srcStart = fiscalYearStart(sourceYear, org.fiscalYearEnd);
    const srcEnd = fiscalYearEndDate(sourceYear, org.fiscalYearEnd);
    const srcPeriods = budgetPeriods(srcStart, srcEnd, dto.period);
    const types = dto.accountTypes?.length ? dto.accountTypes : ['REVENUE', 'EXPENSE'];
    const accounts = await this.prisma.account.findMany({
      where: { organizationId, isActive: true, accountType: { in: types as any } },
    });
    await this.checkDimensions(organizationId, dto.classId, dto.locationId);
    const actuals = await this.actuals(
      organizationId,
      srcPeriods,
      accounts.map((a) => ({ id: a.id, accountType: a.accountType })),
      dto.classId,
      dto.locationId,
    );
    const factor = 1 + (dto.growthPercent ?? 0) / 100;
    const lineItems: BudgetLineItemDto[] = [];
    for (const a of accounts) {
      const row = actuals.get(a.id);
      if (!row || row.every((x) => x === 0)) continue;
      lineItems.push({ accountId: a.id, periodAmounts: row.map((x) => round2(x * factor)) });
    }
    return this.createBudget(organizationId, {
      budgetName: dto.budgetName,
      fiscalYear: dto.fiscalYear,
      period: dto.period,
      classId: dto.classId,
      locationId: dto.locationId,
      notes: `Seeded from fiscal ${sourceYear} actuals${dto.growthPercent ? `, ${dto.growthPercent > 0 ? '+' : ''}${dto.growthPercent}%` : ''}.`,
      lineItems,
    });
  }

  async getBudget(organizationId: string, budgetId: string) {
    return this.present(await this.load(organizationId, budgetId));
  }

  async listBudgets(organizationId: string, filters?: { fiscalYear?: number; status?: string }) {
    const budgets = await this.prisma.budget.findMany({
      where: {
        organizationId,
        ...(filters?.fiscalYear && { fiscalYear: filters.fiscalYear }),
        ...(filters?.status && { status: filters.status }),
      },
      include: lineInclude,
      orderBy: [{ fiscalYear: 'desc' }, { budgetName: 'asc' }],
    });
    return budgets.map((b) => this.present(b));
  }

  async updateBudget(organizationId: string, budgetId: string, dto: UpdateBudgetDto) {
    const budget = await this.load(organizationId, budgetId);
    if (dto.lineItems) this.mustBeDraft(budget);
    if (dto.budgetName && dto.budgetName !== budget.budgetName) {
      await this.ensureUniqueName(organizationId, dto.budgetName, budget.fiscalYear);
    }
    const n = this.periodsOf(budget).length;
    const lines = dto.lineItems ? await this.planLines(organizationId, n, dto.lineItems) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.budget.update({
        where: { id: budgetId },
        data: { budgetName: dto.budgetName, notes: dto.notes },
      });
      if (lines) {
        await tx.budgetLineItem.deleteMany({ where: { budgetId } });
        await tx.budgetLineItem.createMany({ data: lines.map((l) => ({ ...l, budgetId })) });
      }
    });
    return this.getBudget(organizationId, budgetId);
  }

  /** Sets one line's plan, adding the line if the account isn't in the budget yet. */
  async updateBudgetLineItem(
    organizationId: string,
    budgetId: string,
    item: BudgetLineItemDto & { forecastAmount?: number },
  ) {
    const budget = await this.load(organizationId, budgetId);
    this.mustBeDraft(budget);
    const [line] = await this.planLines(organizationId, this.periodsOf(budget).length, [item]);
    await this.prisma.budgetLineItem.upsert({
      where: { budgetId_accountId: { budgetId, accountId: item.accountId } },
      create: { ...line, budgetId },
      update: {
        budgetAmount: line.budgetAmount,
        periodAmounts: line.periodAmounts,
        ...(item.forecastAmount !== undefined && { forecastAmount: item.forecastAmount }),
      },
    });
    return this.getBudget(organizationId, budgetId);
  }

  async removeLineItem(organizationId: string, budgetId: string, accountId: string) {
    const budget = await this.load(organizationId, budgetId);
    this.mustBeDraft(budget);
    await this.prisma.budgetLineItem.deleteMany({ where: { budgetId, accountId } });
    return this.getBudget(organizationId, budgetId);
  }

  // ---- Status --------------------------------------------------------------

  async approveBudget(organizationId: string, budgetId: string) {
    return this.transition(organizationId, budgetId, ['DRAFT'], 'APPROVED', 'Only draft budgets can be approved');
  }

  async activateBudget(organizationId: string, budgetId: string) {
    return this.transition(organizationId, budgetId, ['APPROVED'], 'ACTIVE', 'Only approved budgets can be activated');
  }

  async closeBudget(organizationId: string, budgetId: string) {
    return this.transition(organizationId, budgetId, ['DRAFT', 'APPROVED', 'ACTIVE'], 'CLOSED', 'The budget is already closed');
  }

  /** Sends an approved or active budget back to draft so its plan can change. */
  async reopenBudget(organizationId: string, budgetId: string) {
    return this.transition(organizationId, budgetId, ['APPROVED', 'ACTIVE', 'CLOSED'], 'DRAFT', 'The budget is already a draft');
  }

  async deleteBudget(organizationId: string, budgetId: string) {
    const budget = await this.load(organizationId, budgetId);
    if (budget.status !== 'DRAFT') {
      throw new BadRequestException('Can only delete draft budgets');
    }
    await this.prisma.budget.delete({ where: { id: budgetId } });
    this.logger.log(`Budget ${budget.budgetName} deleted`);
  }

  // ---- Budget vs actual ----------------------------------------------------

  /**
   * Budget against actuals from the ledger (posted journals only), period by period.
   * Year to date counts every period that has started by asOf.
   */
  async getBudgetVariance(organizationId: string, budgetId: string, asOfInput?: string) {
    const budget = await this.load(organizationId, budgetId);
    const asOf = this.asOf(asOfInput);
    const periods = this.periodsOf(budget);
    const actuals = await this.actuals(
      organizationId,
      periods,
      budget.lineItems.map((l) => ({ id: l.accountId, accountType: l.account.accountType })),
      budget.classId,
      budget.locationId,
    );
    const started = periods.filter((p) => p.start.getTime() <= asOf.getTime()).length;
    const closed = closedPeriods(periods, asOf);

    const lines = budget.lineItems.map((l) => {
      const plan = this.planOf(l, periods.length);
      const actual = actuals.get(l.accountId) ?? periods.map(() => 0);
      const budgetTotal = sum(plan);
      const actualTotal = sum(actual);
      const ytdBudget = sum(plan.slice(0, started));
      const ytdActual = sum(actual.slice(0, started));
      const type = l.account.accountType;
      return {
        accountId: l.accountId,
        accountNumber: l.account.accountNumber,
        accountName: l.account.name,
        accountType: type,
        budget: plan,
        actual,
        budgetTotal,
        actualTotal,
        ytdBudget,
        ytdActual,
        ytdVariance: round2(ytdActual - ytdBudget),
        ytdVariancePercent: variancePercent(ytdBudget, ytdActual),
        favorable: isFavorable(type, ytdBudget, ytdActual),
        forecast: (l.forecastPeriods ?? []).map(num),
        forecastTotal: num(l.forecastAmount),
        // Field names the older budget API returned, kept for its callers.
        budgetAmount: budgetTotal,
        actualAmount: actualTotal,
        forecastAmount: num(l.forecastAmount),
        actualVariance: round2(actualTotal - budgetTotal),
        actualVariancePercent: variancePercent(budgetTotal, actualTotal) ?? 0,
      };
    });

    const total = (type: string) => {
      const rows = lines.filter((l) => l.accountType === type);
      const budgetP = periods.map((_, i) => sum(rows.map((r) => r.budget[i])));
      const actualP = periods.map((_, i) => sum(rows.map((r) => r.actual[i])));
      return {
        budget: budgetP,
        actual: actualP,
        budgetTotal: sum(budgetP),
        actualTotal: sum(actualP),
        ytdBudget: sum(budgetP.slice(0, started)),
        ytdActual: sum(actualP.slice(0, started)),
      };
    };
    const revenue = total('REVENUE');
    const expense = total('EXPENSE');
    const minus = (a: number[], b: number[]) => a.map((x, i) => round2(x - b[i]));
    const netIncome = {
      budget: minus(revenue.budget, expense.budget),
      actual: minus(revenue.actual, expense.actual),
      budgetTotal: round2(revenue.budgetTotal - expense.budgetTotal),
      actualTotal: round2(revenue.actualTotal - expense.actualTotal),
      ytdBudget: round2(revenue.ytdBudget - expense.ytdBudget),
      ytdActual: round2(revenue.ytdActual - expense.ytdActual),
    };

    return {
      budgetId,
      budgetName: budget.budgetName,
      fiscalYear: budget.fiscalYear,
      period: budget.period,
      status: budget.status,
      classId: budget.classId,
      locationId: budget.locationId,
      asOf: asOf.toISOString().slice(0, 10),
      periods: periods.map((p) => ({
        index: p.index,
        label: p.label,
        start: p.start.toISOString().slice(0, 10),
        end: p.end.toISOString().slice(0, 10),
        closed: p.index < closed,
      })),
      lineItems: lines,
      totals: { revenue, expense, netIncome },
    };
  }

  // ---- Forecast ------------------------------------------------------------

  /** A rolling forecast: actuals for closed periods, the rest projected by the chosen method. */
  async getForecast(organizationId: string, budgetId: string, method: ForecastMethod, asOfInput?: string) {
    const report = await this.getBudgetVariance(organizationId, budgetId, asOfInput);
    const closed = report.periods.filter((p) => p.closed).length;
    const lines = report.lineItems.map((l) => {
      const forecast = forecastLine(l.budget, l.actual, closed, method);
      const forecastTotal = sum(forecast);
      return {
        accountId: l.accountId,
        accountNumber: l.accountNumber,
        accountName: l.accountName,
        accountType: l.accountType,
        budget: l.budget,
        actual: l.actual,
        forecast,
        budgetTotal: l.budgetTotal,
        forecastTotal,
        variance: round2(forecastTotal - l.budgetTotal),
        variancePercent: variancePercent(l.budgetTotal, forecastTotal),
        favorable: isFavorable(l.accountType, l.budgetTotal, forecastTotal),
      };
    });
    const totalOf = (type: string) => sum(lines.filter((l) => l.accountType === type).map((l) => l.forecastTotal));
    const revenue = totalOf('REVENUE');
    const expense = totalOf('EXPENSE');
    return {
      budgetId,
      budgetName: report.budgetName,
      method,
      asOf: report.asOf,
      periods: report.periods,
      lineItems: lines,
      totals: {
        revenue: { budget: report.totals.revenue.budgetTotal, forecast: revenue },
        expense: { budget: report.totals.expense.budgetTotal, forecast: expense },
        netIncome: { budget: report.totals.netIncome.budgetTotal, forecast: round2(revenue - expense) },
      },
    };
  }

  /** Runs a forecast and stores it on the budget's lines, so the variance view shows it. */
  async saveForecast(organizationId: string, budgetId: string, method: ForecastMethod, asOfInput?: string) {
    const f = await this.getForecast(organizationId, budgetId, method, asOfInput);
    await this.prisma.$transaction([
      ...f.lineItems.map((l) =>
        this.prisma.budgetLineItem.update({
          where: { budgetId_accountId: { budgetId, accountId: l.accountId } },
          data: { forecastPeriods: l.forecast, forecastAmount: l.forecastTotal },
        }),
      ),
      this.prisma.budget.update({
        where: { id: budgetId },
        data: { forecastMethod: method, forecastAsOf: new Date(`${f.asOf}T00:00:00Z`) },
      }),
    ]);
    return f;
  }

  // ---- Internals -----------------------------------------------------------

  /** Posted ledger activity per account and period, on each account's natural side. */
  private async actuals(
    organizationId: string,
    periods: Period[],
    accounts: { id: string; accountType: string }[],
    classId?: string | null,
    locationId?: string | null,
  ): Promise<Map<string, number[]>> {
    if (!accounts.length || !periods.length) return new Map();
    const start = periods[0].start;
    const endExcl = new Date(periods[periods.length - 1].end.getTime() + 86_400_000);
    const ids = accounts.map((a) => a.id);
    const rows = await this.prisma.$queryRaw<{ accountId: string; month: Date; debit: unknown; credit: unknown }[]>`
      SELECT jl."accountId", date_trunc('month', j."journalDate") AS month,
             COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
      FROM "JournalLine" jl
      JOIN "Journal" j ON j.id = jl."journalId"
      WHERE j."organizationId" = ${organizationId}
        AND j.status = 'POSTED'
        AND j."journalDate" >= ${start} AND j."journalDate" < ${endExcl}
        AND jl."accountId" = ANY(${ids})
        ${classId ? Prisma.sql`AND jl."classId" = ${classId}` : Prisma.empty}
        ${locationId ? Prisma.sql`AND jl."locationId" = ${locationId}` : Prisma.empty}
      GROUP BY 1, 2`;
    return actualsByPeriod(
      rows.map((r) => ({ accountId: r.accountId, month: new Date(r.month), debit: Number(r.debit), credit: Number(r.credit) })),
      periods,
      new Map(accounts.map((a) => [a.id, a.accountType])),
    );
  }

  private async load(organizationId: string, budgetId: string): Promise<BudgetWithLines> {
    const budget = await this.prisma.budget.findUnique({ where: { id: budgetId }, include: lineInclude });
    if (!budget || budget.organizationId !== organizationId) {
      throw new NotFoundException('Budget not found');
    }
    return budget;
  }

  private periodsOf(b: { startDate: Date; endDate: Date; period: string }): Period[] {
    return budgetPeriods(b.startDate, b.endDate, b.period as BudgetPeriodKind);
  }

  /** A line's per-period plan; lines saved before periods existed spread their total. */
  private planOf(l: { budgetAmount: Prisma.Decimal; periodAmounts: Prisma.Decimal[] }, n: number): number[] {
    if (l.periodAmounts?.length === n) return l.periodAmounts.map(num);
    return planFor(n, { budgetAmount: num(l.budgetAmount) });
  }

  private present(b: BudgetWithLines) {
    const periods = this.periodsOf(b);
    const lineItems = b.lineItems.map((l) => {
      const plan = this.planOf(l, periods.length);
      return {
        id: l.id,
        accountId: l.accountId,
        account: { id: l.account.id, accountNumber: l.account.accountNumber, name: l.account.name, accountType: l.account.accountType },
        periodAmounts: plan,
        budgetAmount: sum(plan),
        forecastAmount: num(l.forecastAmount),
        forecastPeriods: (l.forecastPeriods ?? []).map(num),
      };
    });
    const totalOf = (type: string) => sum(lineItems.filter((l) => l.account.accountType === type).map((l) => l.budgetAmount));
    return {
      id: b.id,
      organizationId: b.organizationId,
      budgetName: b.budgetName,
      fiscalYear: b.fiscalYear,
      period: b.period,
      startDate: b.startDate,
      endDate: b.endDate,
      status: b.status,
      classId: b.classId,
      locationId: b.locationId,
      notes: b.notes,
      forecastMethod: b.forecastMethod,
      forecastAsOf: b.forecastAsOf,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      periods: periods.map((p) => ({ index: p.index, label: p.label, start: p.start.toISOString().slice(0, 10), end: p.end.toISOString().slice(0, 10) })),
      lineItems,
      totals: {
        revenue: totalOf('REVENUE'),
        expense: totalOf('EXPENSE'),
        netIncome: round2(totalOf('REVENUE') - totalOf('EXPENSE')),
      },
    };
  }

  private async planLines(organizationId: string, n: number, items: BudgetLineItemDto[]) {
    const ids = [...new Set(items.map((i) => i.accountId))];
    if (ids.length !== items.length) throw new BadRequestException('Each account can appear once in a budget');
    const found = await this.prisma.account.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } });
    const missing = ids.filter((id) => !found.some((a) => a.id === id));
    if (missing.length) throw new NotFoundException(`Account ${missing[0]} not found`);
    return items.map((i) => {
      let plan: number[];
      try {
        plan = planFor(n, i);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      return { accountId: i.accountId, periodAmounts: plan, budgetAmount: sum(plan) };
    });
  }

  private async range(organizationId: string, fiscalYear: number, startDate?: string, endDate?: string) {
    const org = await this.org(organizationId);
    const start = startDate ? new Date(`${startDate.slice(0, 10)}T00:00:00Z`) : fiscalYearStart(fiscalYear, org.fiscalYearEnd);
    const end = endDate ? new Date(`${endDate.slice(0, 10)}T00:00:00Z`) : fiscalYearEndDate(fiscalYear, org.fiscalYearEnd);
    if (end < start) throw new BadRequestException('The budget ends before it starts');
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
    if (months > 36) throw new BadRequestException('A budget can cover at most 36 months');
    return { start, end };
  }

  private async org(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private async checkDimensions(organizationId: string, classId?: string | null, locationId?: string | null) {
    if (classId && !(await this.prisma.class.findFirst({ where: { id: classId, organizationId } }))) {
      throw new NotFoundException('Class not found');
    }
    if (locationId && !(await this.prisma.location.findFirst({ where: { id: locationId, organizationId } }))) {
      throw new NotFoundException('Location not found');
    }
  }

  private async ensureUniqueName(organizationId: string, budgetName: string, fiscalYear: number) {
    const clash = await this.prisma.budget.findFirst({ where: { organizationId, budgetName, fiscalYear } });
    if (clash) throw new BadRequestException(`There is already a budget named ${budgetName} for ${fiscalYear}`);
  }

  private mustBeDraft(b: { status: string }) {
    if (b.status !== 'DRAFT') {
      throw new BadRequestException('Only a draft budget can change. Reopen it to edit the plan.');
    }
  }

  private async transition(organizationId: string, budgetId: string, from: string[], to: string, message: string) {
    const budget = await this.load(organizationId, budgetId);
    if (!from.includes(budget.status)) throw new BadRequestException(message);
    await this.prisma.budget.update({ where: { id: budgetId }, data: { status: to } });
    return this.getBudget(organizationId, budgetId);
  }

  private asOf(input?: string): Date {
    if (!input) {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    const d = new Date(`${input.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('asOf must be a date like 2026-06-30');
    return d;
  }
}
