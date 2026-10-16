import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationService } from './organization.service';
import { AccountingMethod, EntityType } from './dto/organization.dto';

/** The Books user on a request, as the suite sign-in guard sets it. */
export interface BooksUser {
  id: string;
  email: string;
  role: string;
  organizationId: string;
}

export const COMPANY_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'USER'] as const;
/** Roles that may post entries and run group reports across companies. */
export const FINANCE_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT'];

/**
 * Multi-company access. Each person works in one company at a time (User.organizationId,
 * which every org-scoped route checks) and can belong to several through OrganizationUser,
 * each with its own role. Switching company moves their working company and role.
 */
@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
  ) {}

  /** Companies this person belongs to, their role in each, and which one they're in now. */
  async list(user: BooksUser) {
    await this.ensureHome(user);
    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId: user.id },
      include: { organization: true },
      orderBy: { organization: { name: 'asc' } },
    });
    return memberships
      .filter((m) => m.organization.isActive !== false)
      .map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        currency: m.organization.defaultCurrency || 'USD',
        fiscalYearEnd: m.organization.fiscalYearEnd,
        role: m.role,
        current: m.organization.id === user.organizationId,
      }));
  }

  /** Adds a company with the standard chart of accounts. Its creator becomes its admin. */
  async create(
    user: BooksUser,
    dto: { name: string; defaultCurrency?: string; fiscalYearEnd?: number; entityType?: EntityType; legalName?: string },
  ) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only an admin can add a company.');
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Give the company a name.');
    const currency = (dto.defaultCurrency || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Currency must be a three-letter code like USD.');
    if (dto.fiscalYearEnd !== undefined && !(Number.isInteger(dto.fiscalYearEnd) && dto.fiscalYearEnd >= 1 && dto.fiscalYearEnd <= 12)) {
      throw new BadRequestException('Fiscal year end is a month from 1 to 12.');
    }
    const org = await this.organizations.create({
      name,
      legalName: dto.legalName,
      entityType: dto.entityType || EntityType.LLC,
      accountingMethod: AccountingMethod.ACCRUAL,
      fiscalYearEnd: dto.fiscalYearEnd,
      defaultCurrency: currency,
    });
    await this.prisma.organizationUser.create({
      data: { organizationId: org.id, userId: user.id, role: 'ADMIN', permissions: [] },
    });
    this.logger.log(`${user.email} added company ${org.id}`);
    return { id: org.id, name: org.name, currency, role: 'ADMIN', current: false };
  }

  /** Makes another of their companies the one they work in. */
  async switchTo(user: BooksUser, organizationId: string) {
    const m = await this.membership(user, organizationId);
    if (!m) throw new ForbiddenException('You are not a member of that company.');
    await this.prisma.user.update({ where: { id: user.id }, data: { organizationId, role: m.role } });
    return { organizationId, role: m.role };
  }

  async members(user: BooksUser, organizationId: string) {
    await this.requireRole(user, [organizationId]);
    const rows = await this.prisma.organizationUser.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } } });
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.userId);
      return {
        userId: r.userId,
        email: u?.email ?? '',
        name: u ? `${u.firstName} ${u.lastName}`.trim() : '',
        role: r.role,
        active: u?.isActive ?? false,
      };
    });
  }

  /**
   * Gives someone access to a company. People who haven't opened Books yet get their Books
   * account now, working in this company, and take it over when they first sign in.
   */
  async addMember(user: BooksUser, organizationId: string, input: { email: string; role?: string }) {
    await this.requireRole(user, [organizationId], ['ADMIN']);
    const email = input.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new BadRequestException('Give an email address.');
    const role = (input.role || 'USER').toUpperCase();
    if (!COMPANY_ROLES.includes(role as any)) throw new BadRequestException(`Role must be one of ${COMPANY_ROLES.join(', ')}.`);

    let member = await this.prisma.user.findUnique({ where: { email } });
    if (!member) {
      const [firstName, ...rest] = email.split('@')[0].split(/[._-]/);
      member = await this.prisma.user.create({
        data: { email, password: '!', firstName: firstName || email, lastName: rest.join(' '), organizationId, role },
      });
    }
    await this.prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId, userId: member.id } },
      create: { organizationId, userId: member.id, role, permissions: [] },
      update: { role },
    });
    if (member.organizationId === organizationId && member.role !== role) {
      await this.prisma.user.update({ where: { id: member.id }, data: { role } });
    }
    return this.members(user, organizationId);
  }

  async removeMember(user: BooksUser, organizationId: string, memberUserId: string) {
    await this.requireRole(user, [organizationId], ['ADMIN']);
    const rows = await this.prisma.organizationUser.findMany({ where: { organizationId } });
    const target = rows.find((r) => r.userId === memberUserId);
    if (!target) throw new NotFoundException('That person is not a member of this company.');
    if (target.role === 'ADMIN' && rows.filter((r) => r.role === 'ADMIN').length === 1) {
      throw new BadRequestException('A company needs at least one admin.');
    }
    const elsewhere = await this.prisma.organizationUser.findFirst({
      where: { userId: memberUserId, organizationId: { not: organizationId } },
    });
    const member = await this.prisma.user.findUnique({ where: { id: memberUserId } });
    if (member?.organizationId === organizationId) {
      if (!elsewhere) {
        throw new BadRequestException('This is their only company. Give them another company first.');
      }
      await this.prisma.user.update({
        where: { id: memberUserId },
        data: { organizationId: elsewhere.organizationId, role: elsewhere.role },
      });
    }
    await this.prisma.organizationUser.delete({ where: { id: target.id } });
    return this.members(user, organizationId);
  }

  /** Throws unless the person belongs to every company named, with one of the roles if given. */
  async requireRole(user: BooksUser, organizationIds: string[], roles?: string[]) {
    await this.ensureHome(user);
    const ids = [...new Set(organizationIds)];
    const rows = await this.prisma.organizationUser.findMany({
      where: { userId: user.id, organizationId: { in: ids } },
    });
    for (const id of ids) {
      const m = rows.find((r) => r.organizationId === id);
      if (!m) throw new ForbiddenException('You do not have access to that organization.');
      if (roles && !roles.includes(m.role)) {
        throw new ForbiddenException(`You need to be ${roles.join(' or ').toLowerCase()} in every company involved.`);
      }
    }
  }

  private async membership(user: BooksUser, organizationId: string) {
    await this.ensureHome(user);
    return this.prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
  }

  /** People who joined before memberships existed still belong to the company they work in. */
  private async ensureHome(user: BooksUser) {
    await this.prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: user.organizationId, userId: user.id } },
      create: { organizationId: user.organizationId, userId: user.id, role: user.role, permissions: [] },
      update: {},
    });
  }
}
