import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalService } from '../journal/journal.service';
import { JournalType } from '../journal/dto/journal.dto';
import { BooksUser, CompaniesService, FINANCE_ROLES } from '../organization/companies.service';
import { AccountActivity, AccountKind, CompanyInput, consolidate, matchIntercompany, round2 } from './consolidate';
import { CreateGroupDto, CreateIntercompanyDto, SetRateDto, UpdateGroupDto } from './consolidation.dto';

/** Lines tagged this way, with the counterparty company as referenceId, are eliminated on consolidation. */
export const INTERCOMPANY = 'INTERCOMPANY';
const IC_RECEIVABLE = { accountNumber: '1450', name: 'Intercompany Receivable', accountType: 'ASSET', normalBalance: 'DEBIT', accountSubtype: 'CURRENT_ASSET' } as const;
const IC_PAYABLE = { accountNumber: '2450', name: 'Intercompany Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', accountSubtype: 'CURRENT_LIABILITY' } as const;

const DAY = 86_400_000;
const isoDay = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);

@Injectable()
export class ConsolidationService {
  private readonly logger = new Logger(ConsolidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalService,
    private readonly companies: CompaniesService,
  ) {}

  // ---- Groups --------------------------------------------------------------

  /** Groups whose companies the person can all see. */
  async listGroups(user: BooksUser) {
    const mine = new Set((await this.companies.list(user)).map((c) => c.id));
    const groups = await this.prisma.consolidationGroup.findMany({
      include: { members: { include: { organization: { select: { id: true, name: true, defaultCurrency: true } } } } },
      orderBy: { name: 'asc' },
    });
    return groups.filter((g) => g.members.every((m) => mine.has(m.organizationId))).map((g) => this.presentGroup(g));
  }

  async getGroup(user: BooksUser, id: string) {
    const g = await this.loadGroup(id);
    await this.companies.requireRole(user, g.members.map((m) => m.organizationId));
    return this.presentGroup(g);
  }

  async createGroup(user: BooksUser, dto: CreateGroupDto) {
    const ids = this.memberIds(dto.organizationIds, dto.parentOrganizationId);
    await this.companies.requireRole(user, ids, FINANCE_ROLES);
    const g = await this.prisma.consolidationGroup.create({
      data: {
        name: dto.name.trim(),
        reportingCurrency: dto.reportingCurrency.toUpperCase(),
        parentOrganizationId: dto.parentOrganizationId,
        createdBy: user.id,
        members: { create: ids.map((organizationId) => ({ organizationId })) },
      },
      include: { members: { include: { organization: { select: { id: true, name: true, defaultCurrency: true } } } } },
    });
    return this.presentGroup(g);
  }

  async updateGroup(user: BooksUser, id: string, dto: UpdateGroupDto) {
    const g = await this.loadGroup(id);
    await this.companies.requireRole(user, g.members.map((m) => m.organizationId), FINANCE_ROLES);
    const parent = dto.parentOrganizationId ?? g.parentOrganizationId;
    const ids = dto.organizationIds ? this.memberIds(dto.organizationIds, parent) : null;
    if (ids) await this.companies.requireRole(user, ids, FINANCE_ROLES);
    else if (!g.members.some((m) => m.organizationId === parent)) {
      throw new BadRequestException('The parent company must be in the group.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.consolidationGroup.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          reportingCurrency: dto.reportingCurrency?.toUpperCase(),
          parentOrganizationId: parent,
        },
      });
      if (ids) {
        await tx.consolidationMember.deleteMany({ where: { groupId: id, organizationId: { notIn: ids } } });
        for (const organizationId of ids) {
          await tx.consolidationMember.upsert({
            where: { groupId_organizationId: { groupId: id, organizationId } },
            create: { groupId: id, organizationId },
            update: {},
          });
        }
      }
    });
    return this.getGroup(user, id);
  }

  async deleteGroup(user: BooksUser, id: string) {
    const g = await this.loadGroup(id);
    await this.companies.requireRole(user, g.members.map((m) => m.organizationId), FINANCE_ROLES);
    await this.prisma.consolidationGroup.delete({ where: { id } });
  }

  // ---- Report --------------------------------------------------------------

  /**
   * Consolidated income statement for [startDate, endDate] and balance sheet at endDate, with a
   * column per company, the eliminations, and the group total, in the reporting currency.
   */
  async report(user: BooksUser, id: string, startDate?: string, endDate?: string) {
    const g = await this.loadGroup(id);
    const memberIds = g.members.map((m) => m.organizationId);
    await this.companies.requireRole(user, memberIds);

    const today = new Date();
    const end = endDate ? isoDay(endDate) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const start = startDate ? isoDay(startDate) : new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException('Dates look like 2026-12-31.');
    if (end < start) throw new BadRequestException('The period ends before it starts.');

    // The parent goes first so its chart of accounts names the lines.
    const ordered = [...g.members].sort((a, b) =>
      a.organizationId === g.parentOrganizationId ? -1 : b.organizationId === g.parentOrganizationId ? 1 : a.organization.name.localeCompare(b.organization.name),
    );

    const missing: string[] = [];
    const inputs: CompanyInput[] = [];
    for (const m of ordered) {
      const currency = m.organization.defaultCurrency || 'USD';
      const closing = await this.rate(currency, g.reportingCurrency, end);
      const average = await this.averageRate(currency, g.reportingCurrency, start, end);
      if (closing == null) missing.push(`${currency} to ${g.reportingCurrency}`);
      inputs.push({
        id: m.organizationId,
        name: m.organization.name,
        currency,
        closingRate: closing ?? 1,
        averageRate: average ?? closing ?? 1,
        accounts: await this.activity(m.organizationId, memberIds, start, end),
      });
    }
    if (missing.length) {
      throw new BadRequestException(`Add an exchange rate for ${[...new Set(missing)].join(', ')} on or before ${end.toISOString().slice(0, 10)}.`);
    }

    const result = consolidate(inputs);
    const intercompany = matchIntercompany(
      await this.intercompanyBalances(memberIds, end),
      (orgId) => inputs.find((c) => c.id === orgId)!.closingRate,
    ).map((p) => ({
      ...p,
      fromName: inputs.find((c) => c.id === p.from)?.name ?? p.from,
      toName: inputs.find((c) => c.id === p.to)?.name ?? p.to,
    }));

    const warnings: string[] = [];
    for (const c of result.companies) {
      if (Math.abs(c.localImbalance) >= 0.01) warnings.push(`${c.name}'s posted entries are out of balance by ${c.localImbalance.toFixed(2)} ${c.currency}.`);
    }
    for (const p of intercompany) {
      if (Math.abs(p.difference) >= 0.01) {
        const amt = (n: number) => `${n.toFixed(2)} ${g.reportingCurrency}`;
        warnings.push(`${p.fromName} shows ${amt(p.receivable)} owed by ${p.toName}, who shows ${amt(p.payable)} owed back.`);
      }
    }

    return {
      group: this.presentGroup(g),
      reportingCurrency: g.reportingCurrency,
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      ...result,
      intercompany,
      warnings,
    };
  }

  // ---- Intercompany --------------------------------------------------------

  async listIntercompany(user: BooksUser, organizationId?: string) {
    const mine = (await this.companies.list(user)).map((c) => c.id);
    const ids = organizationId ? mine.filter((x) => x === organizationId) : mine;
    const rows = await this.prisma.intercompanyTransaction.findMany({
      where: { OR: [{ fromOrganizationId: { in: ids } }, { toOrganizationId: { in: ids } }] },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => [r.fromOrganizationId, r.toOrganizationId]))] } },
      select: { id: true, name: true, defaultCurrency: true },
    });
    const journals = await this.prisma.journal.findMany({
      where: { id: { in: rows.flatMap((r) => [r.fromJournalId, r.toJournalId]).filter((x): x is string => !!x) } },
      select: { id: true, journalNumber: true, status: true },
    });
    const org = (id: string) => orgs.find((o) => o.id === id);
    const j = (id: string | null) => journals.find((x) => x.id === id);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      date: r.date.toISOString().slice(0, 10),
      description: r.description,
      from: { id: r.fromOrganizationId, name: org(r.fromOrganizationId)?.name, currency: org(r.fromOrganizationId)?.defaultCurrency || 'USD', amount: Number(r.fromAmount), journal: j(r.fromJournalId) },
      to: { id: r.toOrganizationId, name: org(r.toOrganizationId)?.name, currency: org(r.toOrganizationId)?.defaultCurrency || 'USD', amount: Number(r.toAmount), journal: j(r.toJournalId) },
      rate: Number(r.rate),
      voided: j(r.fromJournalId)?.status === 'VOIDED',
    }));
  }

  /**
   * Records one intercompany entry as a posted journal in each company. The "from" company always
   * holds the receivable:
   * - CHARGE: from bills to (from: receivable / income; to: expense or asset / payable).
   * - LOAN: from sends money to (from: receivable / bank; to: bank / payable).
   * - SETTLEMENT: to pays down what it owes (from: bank / receivable; to: payable / bank).
   * Charges are eliminated in full on consolidation; loans and settlements only on the
   * intercompany accounts, so the bank lines stay.
   */
  async createIntercompany(user: BooksUser, dto: CreateIntercompanyDto) {
    if (dto.fromOrganizationId === dto.toOrganizationId) throw new BadRequestException('Pick two different companies.');
    await this.companies.requireRole(user, [dto.fromOrganizationId, dto.toOrganizationId], FINANCE_ROLES);
    const [fromOrg, toOrg] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: dto.fromOrganizationId } }),
      this.prisma.organization.findUnique({ where: { id: dto.toOrganizationId } }),
    ]);
    if (!fromOrg || !toOrg) throw new NotFoundException('Company not found');
    const [fromAccount, toAccount] = await Promise.all([
      this.prisma.account.findFirst({ where: { id: dto.fromAccountId, organizationId: fromOrg.id, isActive: true } }),
      this.prisma.account.findFirst({ where: { id: dto.toAccountId, organizationId: toOrg.id, isActive: true } }),
    ]);
    if (!fromAccount) throw new NotFoundException(`That account is not in ${fromOrg.name}'s chart of accounts.`);
    if (!toAccount) throw new NotFoundException(`That account is not in ${toOrg.name}'s chart of accounts.`);
    const icNumbers: string[] = [IC_RECEIVABLE.accountNumber, IC_PAYABLE.accountNumber];
    if (icNumbers.includes(fromAccount.accountNumber) || icNumbers.includes(toAccount.accountNumber)) {
      throw new BadRequestException('Pick the income, expense or bank account; Books adds the intercompany side.');
    }

    const date = isoDay(dto.date);
    const fromCur = fromOrg.defaultCurrency || 'USD';
    const toCur = toOrg.defaultCurrency || 'USD';
    const fromAmount = round2(dto.amount);
    let rate = 1;
    if (fromCur !== toCur) {
      if (dto.toAmount) rate = dto.toAmount / fromAmount;
      else {
        const r = await this.rate(fromCur, toCur, date);
        if (r == null) throw new BadRequestException(`Add an exchange rate for ${fromCur} to ${toCur}, or give the amount in ${toCur}.`);
        rate = r;
      }
    }
    const toAmount = fromCur === toCur ? fromAmount : round2(dto.toAmount ?? fromAmount * rate);
    if (fromAmount <= 0 || toAmount <= 0) throw new BadRequestException('Amounts must be more than zero.');

    const receivable = await this.icAccount(fromOrg.id, IC_RECEIVABLE);
    const payable = await this.icAccount(toOrg.id, IC_PAYABLE);
    const tagAll = dto.kind === 'CHARGE';
    const ic = (counterparty: string, tagged = true) =>
      tagged ? { referenceType: INTERCOMPANY, referenceId: counterparty } : {};

    const sides =
      dto.kind === 'SETTLEMENT'
        ? {
            from: [
              { accountId: fromAccount.id, debit: fromAmount, ...ic(toOrg.id, tagAll) },
              { accountId: receivable, credit: fromAmount, ...ic(toOrg.id) },
            ],
            to: [
              { accountId: payable, debit: toAmount, ...ic(fromOrg.id) },
              { accountId: toAccount.id, credit: toAmount, ...ic(fromOrg.id, tagAll) },
            ],
          }
        : {
            from: [
              { accountId: receivable, debit: fromAmount, ...ic(toOrg.id) },
              { accountId: fromAccount.id, credit: fromAmount, ...ic(toOrg.id, tagAll) },
            ],
            to: [
              { accountId: toAccount.id, debit: toAmount, ...ic(fromOrg.id, tagAll) },
              { accountId: payable, credit: toAmount, ...ic(fromOrg.id) },
            ],
          };

    const record = await this.prisma.intercompanyTransaction.create({
      data: {
        kind: dto.kind,
        date,
        description: dto.description.trim(),
        fromOrganizationId: fromOrg.id,
        toOrganizationId: toOrg.id,
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
        fromAmount,
        toAmount,
        rate,
        createdBy: user.id,
      },
    });
    const reference = `IC-${record.id.slice(-8).toUpperCase()}`;
    const post = async (orgId: string, other: string, lines: any[]) => {
      const j = await this.journals.create(
        orgId,
        {
          date: date.toISOString(),
          type: JournalType.GENERAL,
          source: 'SYSTEM' as any,
          reference,
          description: `${dto.description.trim()} (intercompany with ${other})`,
          tags: ['intercompany'],
          lines: lines.map((l) => ({ ...l, description: dto.description.trim() })),
        },
        user.id,
      );
      await this.journals.post(orgId, j.id);
      return j.id;
    };

    let fromJournalId: string | null = null;
    try {
      fromJournalId = await post(fromOrg.id, toOrg.name, sides.from);
      const toJournalId = await post(toOrg.id, fromOrg.name, sides.to);
      await this.prisma.intercompanyTransaction.update({ where: { id: record.id }, data: { fromJournalId, toJournalId } });
    } catch (e) {
      // Keep the two companies in step: undo the half that posted.
      if (fromJournalId) await this.journals.void(fromOrg.id, fromJournalId, 'Intercompany entry failed in the other company', user.id).catch(() => undefined);
      await this.prisma.intercompanyTransaction.delete({ where: { id: record.id } });
      throw e;
    }
    this.logger.log(`Intercompany ${dto.kind} ${reference} ${fromOrg.id} -> ${toOrg.id}`);
    return (await this.listIntercompany(user)).find((r) => r.id === record.id);
  }

  /** Voids both journals of an intercompany entry. */
  async voidIntercompany(user: BooksUser, id: string) {
    const r = await this.prisma.intercompanyTransaction.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Intercompany entry not found');
    await this.companies.requireRole(user, [r.fromOrganizationId, r.toOrganizationId], FINANCE_ROLES);
    for (const [orgId, journalId] of [[r.fromOrganizationId, r.fromJournalId], [r.toOrganizationId, r.toJournalId]] as const) {
      if (!journalId) continue;
      const j = await this.prisma.journal.findUnique({ where: { id: journalId } });
      if (j && j.status !== 'VOIDED') await this.journals.void(orgId, journalId, 'Intercompany entry voided', user.id);
    }
    return { id, voided: true };
  }

  /** A member company's active accounts, for picking the other side of an intercompany entry. */
  async accounts(user: BooksUser, organizationId: string) {
    await this.companies.requireRole(user, [organizationId]);
    return this.prisma.account.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, accountNumber: true, name: true, accountType: true, isBankAccount: true },
      orderBy: { accountNumber: 'asc' },
    });
  }

  // ---- Exchange rates ------------------------------------------------------

  async listRates() {
    const rows = await this.prisma.exchangeRate.findMany({ orderBy: [{ effectiveDate: 'desc' }], take: 200 });
    return rows.map((r) => ({
      id: r.id,
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: Number(r.rate),
      effectiveDate: r.effectiveDate.toISOString().slice(0, 10),
      source: r.source,
    }));
  }

  async setRate(user: BooksUser, dto: SetRateDto) {
    if (!FINANCE_ROLES.includes(user.role)) throw new ForbiddenException('Only an admin, manager or accountant can set exchange rates.');
    const fromCurrency = dto.fromCurrency.toUpperCase();
    const toCurrency = dto.toCurrency.toUpperCase();
    if (fromCurrency === toCurrency) throw new BadRequestException('Pick two different currencies.');
    const effectiveDate = isoDay(dto.effectiveDate);
    await this.prisma.exchangeRate.upsert({
      where: { fromCurrency_toCurrency_effectiveDate: { fromCurrency, toCurrency, effectiveDate } },
      create: { fromCurrency, toCurrency, effectiveDate, rate: dto.rate, source: 'MANUAL' },
      update: { rate: dto.rate, source: 'MANUAL' },
    });
    return this.listRates();
  }

  // ---- Internals -----------------------------------------------------------

  /** Posted activity per account up to `end`, the share in [start, end], and the intercompany share of each. */
  private async activity(organizationId: string, groupIds: string[], start: Date, end: Date): Promise<AccountActivity[]> {
    const endExcl = new Date(end.getTime() + DAY);
    const rows = await this.prisma.$queryRaw<
      { accountNumber: string; name: string; type: string; subtype: string | null; [k: string]: unknown }[]
    >`
      SELECT a."accountNumber", a.name, a."accountType"::text AS type, a."accountSubtype" AS subtype,
        COALESCE(SUM(jl.debit), 0) AS cum_d,
        COALESCE(SUM(jl.credit), 0) AS cum_c,
        COALESCE(SUM(jl.debit) FILTER (WHERE j."journalDate" >= ${start}), 0) AS per_d,
        COALESCE(SUM(jl.credit) FILTER (WHERE j."journalDate" >= ${start}), 0) AS per_c,
        COALESCE(SUM(jl.debit) FILTER (WHERE ${this.elim(groupIds)}), 0) AS ecum_d,
        COALESCE(SUM(jl.credit) FILTER (WHERE ${this.elim(groupIds)}), 0) AS ecum_c,
        COALESCE(SUM(jl.debit) FILTER (WHERE j."journalDate" >= ${start} AND ${this.elim(groupIds)}), 0) AS eper_d,
        COALESCE(SUM(jl.credit) FILTER (WHERE j."journalDate" >= ${start} AND ${this.elim(groupIds)}), 0) AS eper_c
      FROM "JournalLine" jl
      JOIN "Journal" j ON j.id = jl."journalId"
      JOIN "Account" a ON a.id = jl."accountId"
      WHERE j."organizationId" = ${organizationId} AND j.status = 'POSTED' AND j."journalDate" < ${endExcl}
      GROUP BY a.id
      ORDER BY a."accountNumber"`;
    return rows.map((r) => ({
      accountNumber: r.accountNumber,
      name: r.name,
      type: r.type as AccountKind,
      subtype: r.subtype,
      cumDebit: Number(r.cum_d),
      cumCredit: Number(r.cum_c),
      perDebit: Number(r.per_d),
      perCredit: Number(r.per_c),
      elimCumDebit: Number(r.ecum_d),
      elimCumCredit: Number(r.ecum_c),
      elimPerDebit: Number(r.eper_d),
      elimPerCredit: Number(r.eper_c),
    }));
  }

  private elim(groupIds: string[]) {
    return Prisma.sql`jl."referenceType" = ${INTERCOMPANY} AND jl."referenceId" = ANY(${groupIds})`;
  }

  /** Each company's open intercompany receivable and payable per counterparty in the group, in local currency. */
  private async intercompanyBalances(groupIds: string[], end: Date) {
    const rows = await this.prisma.$queryRaw<{ org: string; cp: string; number: string; d: unknown; c: unknown }[]>`
      SELECT j."organizationId" AS org, jl."referenceId" AS cp, a."accountNumber" AS number,
        COALESCE(SUM(jl.debit), 0) AS d, COALESCE(SUM(jl.credit), 0) AS c
      FROM "JournalLine" jl
      JOIN "Journal" j ON j.id = jl."journalId"
      JOIN "Account" a ON a.id = jl."accountId"
      WHERE j."organizationId" = ANY(${groupIds}) AND j.status = 'POSTED' AND j."journalDate" < ${new Date(end.getTime() + DAY)}
        AND ${this.elim(groupIds)}
        AND a."accountNumber" IN (${IC_RECEIVABLE.accountNumber}, ${IC_PAYABLE.accountNumber})
      GROUP BY 1, 2, 3`;
    return rows.map((r) => ({
      organizationId: r.org,
      counterpartyId: r.cp,
      receivable: r.number === IC_RECEIVABLE.accountNumber ? Number(r.d) - Number(r.c) : 0,
      payable: r.number === IC_PAYABLE.accountNumber ? Number(r.c) - Number(r.d) : 0,
    }));
  }

  /** The latest rate on or before the date, directly or as the inverse of the opposite pair. */
  private async rate(from: string, to: string, date: Date): Promise<number | null> {
    if (from === to) return 1;
    const on = new Date(date.getTime() + DAY - 1);
    const [direct, inverse] = await Promise.all([
      this.prisma.exchangeRate.findFirst({ where: { fromCurrency: from, toCurrency: to, effectiveDate: { lte: on } }, orderBy: { effectiveDate: 'desc' } }),
      this.prisma.exchangeRate.findFirst({ where: { fromCurrency: to, toCurrency: from, effectiveDate: { lte: on } }, orderBy: { effectiveDate: 'desc' } }),
    ]);
    if (direct && (!inverse || direct.effectiveDate >= inverse.effectiveDate)) return Number(direct.rate);
    if (inverse && Number(inverse.rate) !== 0) return 1 / Number(inverse.rate);
    return null;
  }

  /** The mean of the rates dated within the period; null when there are none. */
  private async averageRate(from: string, to: string, start: Date, end: Date): Promise<number | null> {
    if (from === to) return 1;
    const within = { gte: start, lt: new Date(end.getTime() + DAY) };
    const rows = await this.prisma.exchangeRate.findMany({
      where: { OR: [{ fromCurrency: from, toCurrency: to, effectiveDate: within }, { fromCurrency: to, toCurrency: from, effectiveDate: within }] },
    });
    const rates = rows
      .map((r) => (r.fromCurrency === from ? Number(r.rate) : Number(r.rate) ? 1 / Number(r.rate) : 0))
      .filter((x) => x > 0);
    return rates.length ? rates.reduce((s, x) => s + x, 0) / rates.length : null;
  }

  private async icAccount(
    organizationId: string,
    spec: typeof IC_RECEIVABLE | typeof IC_PAYABLE,
  ): Promise<string> {
    const existing = await this.prisma.account.findFirst({ where: { organizationId, accountNumber: spec.accountNumber } });
    if (existing) {
      if (existing.accountType !== spec.accountType) {
        throw new BadRequestException(`Account ${spec.accountNumber} is used for something else; Books keeps ${spec.name} there.`);
      }
      return existing.id;
    }
    const created = await this.prisma.account.create({
      data: { organizationId, ...spec, isActive: true, isSystemAccount: true },
    });
    return created.id;
  }

  private memberIds(organizationIds: string[], parent: string) {
    const ids = [...new Set([parent, ...organizationIds])];
    if (ids.length < 2) throw new BadRequestException('A group needs at least two companies.');
    return ids;
  }

  private async loadGroup(id: string) {
    const g = await this.prisma.consolidationGroup.findUnique({
      where: { id },
      include: { members: { include: { organization: { select: { id: true, name: true, defaultCurrency: true } } } } },
    });
    if (!g) throw new NotFoundException('Group not found');
    return g;
  }

  private presentGroup(g: {
    id: string;
    name: string;
    reportingCurrency: string;
    parentOrganizationId: string;
    members: { organizationId: string; organization: { name: string; defaultCurrency: string | null } }[];
  }) {
    return {
      id: g.id,
      name: g.name,
      reportingCurrency: g.reportingCurrency,
      parentOrganizationId: g.parentOrganizationId,
      companies: g.members
        .map((m) => ({ id: m.organizationId, name: m.organization.name, currency: m.organization.defaultCurrency || 'USD' }))
        .sort((a, b) => (a.id === g.parentOrganizationId ? -1 : b.id === g.parentOrganizationId ? 1 : a.name.localeCompare(b.name))),
    };
  }
}
