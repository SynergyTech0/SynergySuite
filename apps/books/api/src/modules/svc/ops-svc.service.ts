import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * What Synergy Ops (manufacturing and assets, apps/ops) sends Books. Ops owns production and
 * maintenance; Books keeps the stock value it reports on and the fixed-asset register it
 * depreciates. Both calls are idempotent on Ops' own reference, so Ops can retry freely.
 */

export interface OpsStockMove {
  /** Ops' id for the move, e.g. "ops-move-42". */
  ref: string;
  sku: string;
  name?: string;
  /** Signed: positive adds stock, negative takes it. */
  qty: number;
  unitCost: number;
  /** receipt, adjust, issue, produce or maintenance. */
  kind: string;
  note?: string;
}

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

/** Books' ledger names for Ops moves. */
const LEDGER_TYPE: Record<string, string> = {
  receipt: 'PURCHASE',
  adjust: 'ADJUSTMENT',
  issue: 'MFG_ISSUE',
  produce: 'MFG_RECEIPT',
  maintenance: 'MAINTENANCE_ISSUE',
};

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
export class OpsSvcService {
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

  async items() {
    const organizationId = await this.organizationId();
    const rows = await this.prisma.inventoryItem.findMany({ where: { organizationId }, orderBy: { sku: 'asc' }, take: 5000 });
    return rows.map((i) => ({
      id: i.id,
      sku: i.sku,
      name: i.name,
      description: i.description ?? '',
      unitCost: Number(i.unitCost),
      quantity: Number(i.quantity),
      reorderPoint: Number(i.reorderPoint),
    }));
  }

  /** Records one Ops stock move against the Books item with the same SKU, adding the item if Books doesn't have it. */
  async stockMove(m: OpsStockMove) {
    if (!m?.ref || !m.sku) throw new BadRequestException('ref and sku are required');
    const qty = money(m.qty, 'qty');
    const unitCost = money(m.unitCost, 'unitCost');
    const organizationId = await this.organizationId();
    const done = await this.prisma.inventoryLedger.findFirst({ where: { referenceId: m.ref, inventoryItem: { organizationId } }, select: { id: true } });
    if (done) return { ok: true, duplicate: true };
    return this.prisma.$transaction(async (tx) => {
      let item = await tx.inventoryItem.findFirst({ where: { organizationId, sku: { equals: m.sku, mode: 'insensitive' } } });
      if (!item) {
        item = await tx.inventoryItem.create({
          data: {
            organizationId,
            sku: m.sku,
            name: m.name || m.sku,
            unitCost: new Prisma.Decimal(unitCost),
            sellingPrice: new Prisma.Decimal(0),
            reorderPoint: new Prisma.Decimal(0),
            accountId: await this.account(organizationId, '1200'),
          },
        });
      }
      // Ops is where production stock is counted, so Books follows it even below zero rather than refusing.
      const balance = new Prisma.Decimal(item.quantity).plus(qty);
      const cost = new Prisma.Decimal(unitCost);
      await tx.inventoryLedger.create({
        data: {
          itemId: item.id,
          transactionType: LEDGER_TYPE[m.kind] ?? 'ADJUSTMENT',
          referenceId: m.ref,
          quantity: new Prisma.Decimal(qty),
          unitCost: cost,
          totalCost: cost.times(qty),
          balanceQty: balance,
          balanceCost: balance.times(cost),
          notes: m.note ? `Ops: ${m.note}`.slice(0, 500) : 'From Synergy Ops',
        },
      });
      const data: Prisma.InventoryItemUpdateInput = { quantity: balance };
      if (qty > 0) data.unitCost = cost;
      await tx.inventoryItem.update({ where: { id: item.id }, data });
      return { ok: true, itemId: item.id };
    });
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
