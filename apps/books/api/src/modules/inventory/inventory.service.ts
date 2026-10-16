import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { v4 as uuidv4 } from 'uuid';

export class CreateInventoryItemDto {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unitCost: number;
  sellingPrice: number;
  reorderPoint: number;
  valuationMethod?: string;
  accountId: string;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createInventoryItem(organizationId: string, dto: CreateInventoryItemDto) {
    // Verify account exists
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });

    if (!account || account.organizationId !== organizationId) {
      throw new NotFoundException('Account not found');
    }

    // Check SKU uniqueness
    const existing = await this.prisma.inventoryItem.findUnique({
      where: {
        organizationId_sku: {
          organizationId,
          sku: dto.sku,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('SKU already exists');
    }

    const item = await this.prisma.inventoryItem.create({
      data: {
        id: uuidv4(),
        organizationId,
        sku: dto.sku,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        unitCost: dto.unitCost,
        sellingPrice: dto.sellingPrice,
        quantity: 0,
        reorderPoint: dto.reorderPoint,
        valuationMethod: (dto.valuationMethod || 'FIFO') as any,
        accountId: dto.accountId,
      },
    });

    this.logger.log(`Inventory item ${dto.sku} created`);
    return item;
  }

  async getInventoryItem(organizationId: string, itemId: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
      include: { ledger: { take: 10, orderBy: { createdAt: 'desc' } } },
    });

    if (!item || item.organizationId !== organizationId) {
      throw new NotFoundException('Inventory item not found');
    }

    return item;
  }

  async listInventoryItems(organizationId: string, filters?: { category?: string; lowStock?: boolean }) {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        organizationId,
        ...(filters?.category && { category: filters.category }),
      },
      include: {
        account: true,
      },
      orderBy: { name: 'asc' },
    });

    if (filters?.lowStock) {
      return items.filter((item) => new Decimal(item.quantity).lessThan(new Decimal(item.reorderPoint)));
    }

    return items;
  }

  async recordInventoryTransaction(
    organizationId: string,
    itemId: string,
    transactionType: string,
    quantity: number,
    unitCost: number,
    referenceId?: string,
    notes?: string,
  ) {
    const item = await this.getInventoryItem(organizationId, itemId);

    const qty = new Decimal(quantity);
    const cost = new Decimal(unitCost);
    const totalCost = qty.times(cost);

    const currentQty = new Decimal(item.quantity);
    let newBalance = currentQty;
    let balanceCost = new Decimal(0);

    if (transactionType === 'PURCHASE') {
      newBalance = currentQty.plus(qty);
      balanceCost = newBalance.times(cost);
    } else if (transactionType === 'SALE') {
      newBalance = currentQty.minus(qty);
      balanceCost = newBalance.times(cost);

      if (newBalance.lessThan(0)) {
        throw new BadRequestException('Insufficient inventory');
      }
    }

    // Record ledger entry
    const ledgerEntry = await this.prisma.inventoryLedger.create({
      data: {
        id: uuidv4(),
        itemId,
        transactionType,
        referenceId,
        quantity: qty.toNumber(),
        unitCost: cost.toNumber(),
        totalCost: totalCost.toNumber(),
        balanceQty: newBalance.toNumber(),
        balanceCost: balanceCost.toNumber(),
        notes,
      },
    });

    // Update item quantity
    await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { quantity: newBalance.toNumber() },
    });

    this.logger.log(`Inventory transaction recorded: ${transactionType} of ${quantity} units for ${item.sku}`);
    return ledgerEntry;
  }

  async getInventoryValuation(organizationId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { organizationId },
    });

    const valuations = items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitCost: item.unitCost,
      totalValue: new Decimal(item.quantity).times(new Decimal(item.unitCost)).toNumber(),
    }));

    const totalValue = valuations.reduce((sum, v) => sum + v.totalValue, 0);

    return {
      items: valuations,
      totalValue,
      asOfDate: new Date(),
    };
  }
}
