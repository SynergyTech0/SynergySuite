import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fixed assets from Synergy Ops (apps/ops): Ops keeps the asset register and its maintenance,
 * Books depreciates what Ops sends it. Stock is not sent here: Commerce owns stock and posts
 * its journals. Idempotent on the asset tag, so Ops can resend an asset freely.
 */

export interface OpsFixedAsset {
  ref: string;
  tag: string;
  name: string;
  category?: string;
  acquisitionDate: string;
  cost: number;
  salvage?: number;
  lifeMonths: number;
  location?: string;
  serial?: string;
  model?: string;
  manufacturer?: string;
  assignedTo?: string;
}

const ASSET_TYPES: [RegExp, string][] = [
  [/vehicle|truck|van|car|forklift|trailer/i, 'VEHICLE'],
  [/computer|laptop|server|it\b|network|printer/i, 'COMPUTER_EQUIPMENT'],
  [/furniture|desk|chair|cabinet/i, 'FURNITURE'],
  [/software|licen[cs]e/i, 'SOFTWARE'],
  [/building/i, 'BUILDING'],
  [/machine|press|lathe|mill|cnc|robot|line/i, 'MACHINERY'],
];

export function assetTypeFor(category: string | undefined): string {
  for (const [re, type] of ASSET_TYPES) if (category && re.test(category)) return type;
  return 'EQUIPMENT';
}

function money(v: unknown, label: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequestException(`${label} must be a number`);
  return n;
}

@Injectable()
export class OpsLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /** The suite runs one Books company; Ops posts into the first one made. */
  private async organizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!org) throw new BadRequestException('Books has no company yet: open Books once to create it');
    return org.id;
  }

  private async account(organizationId: string, number: string): Promise<string> {
    const a = await this.prisma.account.findFirst({ where: { organizationId, accountNumber: number }, select: { id: true } });
    if (!a) throw new BadRequestException(`Books has no account ${number}; add it to the chart of accounts`);
    return a.id;
  }

  /**
   * Adds or updates the fixed asset with the Ops tag as its asset number, depreciated straight
   * line over its useful life on the standard accounts (1500, 1590, 6900).
   */
  async fixedAsset(a: OpsFixedAsset) {
    if (!a?.tag || !a.name) throw new BadRequestException('tag and name are required');
    const cost = money(a.cost, 'cost');
    const salvage = money(a.salvage ?? 0, 'salvage');
    const life = Math.round(money(a.lifeMonths, 'lifeMonths'));
    if (cost <= 0 || life <= 0) throw new BadRequestException('cost and lifeMonths must be more than zero');
    const acquired = new Date(`${a.acquisitionDate}T00:00:00Z`);
    if (Number.isNaN(acquired.getTime())) throw new BadRequestException('acquisitionDate must be a date');
    const organizationId = await this.organizationId();
    const details = {
      name: a.name,
      description: a.category ? `${a.category} (from Synergy Ops)` : 'From Synergy Ops',
      location: a.location || null,
      serialNumber: a.serial || null,
      modelNumber: a.model || null,
      manufacturer: a.manufacturer || null,
      assignedTo: a.assignedTo || null,
    };
    const existing = await this.prisma.fixedAsset.findFirst({ where: { organizationId, assetNumber: a.tag }, select: { id: true } });
    if (existing) {
      await this.prisma.fixedAsset.update({ where: { id: existing.id }, data: details });
      return { id: existing.id, updated: true };
    }
    const created = await this.prisma.fixedAsset.create({
      data: {
        organizationId,
        assetNumber: a.tag,
        assetType: assetTypeFor(a.category) as Prisma.FixedAssetCreateInput['assetType'],
        status: 'ACTIVE',
        acquisitionDate: acquired,
        acquisitionCost: new Prisma.Decimal(cost),
        acquisitionMethod: 'PURCHASE',
        currentBookValue: new Prisma.Decimal(cost),
        accumulatedDepreciation: new Prisma.Decimal(0),
        tags: ['ops', a.ref],
        ...details,
        accounts: {
          create: {
            assetAccountId: await this.account(organizationId, '1500'),
            accumulatedDepAccountId: await this.account(organizationId, '1590'),
            depreciationExpenseAccountId: await this.account(organizationId, '6900'),
          },
        },
        depreciation: {
          create: { method: 'STRAIGHT_LINE', usefulLifeMonths: life, salvageValue: new Prisma.Decimal(salvage), startDate: acquired, isActive: true },
        },
      },
      select: { id: true },
    });
    return { id: created.id, updated: false };
  }
}
