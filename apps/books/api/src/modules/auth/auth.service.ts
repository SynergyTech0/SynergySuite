import { Injectable, Logger } from '@nestjs/common';
import type { Identity } from '@synergy/identity';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationService } from '../organization/organization.service';
import { AccountingMethod, EntityType } from '../organization/dto/organization.dto';

/**
 * Maps a suite identity to a Books user. Self-hosted Books keeps one company by default:
 * the first person to open Books creates it and becomes its admin, and everyone after
 * joins it as a user. Admins can change roles and deactivate people in Books.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
  ) {}

  async userFor(who: Identity) {
    const email = who.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    const [firstName, ...rest] = (who.name || email.split('@')[0]).split(' ');
    let org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    const firstUser = !org;
    if (!org) {
      // Creates the company with a standard chart of accounts.
      org = await this.organizations.create({
        name: process.env.BOOKS_COMPANY_NAME || 'My Company',
        entityType: EntityType.LLC,
        accountingMethod: AccountingMethod.ACCRUAL,
      });
      this.logger.log(`Created organization ${org.id} for the first Books user`);
    }
    return this.prisma.user.create({
      data: {
        email,
        // Sign-in is handled by SynergyAuth; Books never stores or checks a password.
        password: '!',
        firstName: firstName || email,
        lastName: rest.join(' '),
        organizationId: org.id,
        role: firstUser ? 'ADMIN' : 'USER',
      },
    });
  }
}
