import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, IsIn, IsArray, ValidateNested, ArrayMinSize, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export class BundleItemDto {
  @IsString()
  inventoryItemId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
}

export class CreateBundleDto {
  @IsString()
  sku: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(['BUNDLE', 'KIT', 'ASSEMBLY'])
  bundleType: 'BUNDLE' | 'KIT' | 'ASSEMBLY';

  @IsNumber()
  sellingPrice: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  items: BundleItemDto[];
}

export class BuildAssemblyDto {
  @IsString()
  bundleId: string;

  @IsNumber()
  @IsPositive()
  quantityToBuild: number;

  @IsOptional()
  buildDate?: Date;

  @IsString()
  @IsOptional()
  notes?: string;
}

@Injectable()
export class InventoryBundlesService {
  private readonly logger = new Logger(InventoryBundlesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Bundle/Kit Management
  async createBundle(organizationId: string, dto: CreateBundleDto) {
    // Validate all component items exist
    const itemIds = dto.items.map((i) => i.inventoryItemId);
    const existingItems = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, organizationId },
    });

    if (existingItems.length !== itemIds.length) {
      throw new BadRequestException('One or more inventory items not found');
    }

    // Check SKU uniqueness
    const existingBundle = await this.prisma.inventoryBundle.findUnique({
      where: {
        organizationId_sku: {
          organizationId,
          sku: dto.sku,
        },
      },
    });

    if (existingBundle) {
      throw new BadRequestException('Bundle SKU already exists');
    }

    // Calculate total component cost
    const itemCostMap = new Map(existingItems.map((i) => [i.id, Number(i.unitCost)]));
    const totalComponentCost = dto.items.reduce((sum, item) => {
      const unitCost = itemCostMap.get(item.inventoryItemId) || 0;
      return sum + unitCost * item.quantity;
    }, 0);

    // Create bundle
    const bundle = await this.prisma.inventoryBundle.create({
      data: {
        organizationId,
        sku: dto.sku,
        name: dto.name,
        description: dto.description,
        bundleType: dto.bundleType,
        sellingPrice: new Prisma.Decimal(dto.sellingPrice),
        totalComponentCost: new Prisma.Decimal(totalComponentCost),
        quantityOnHand: 0,
        isActive: true,
        components: {
          create: dto.items.map((item) => ({
            inventoryItemId: item.inventoryItemId,
            quantity: item.quantity,
            unitCostAtCreation: new Prisma.Decimal(itemCostMap.get(item.inventoryItemId) || 0),
          })),
        },
      },
      include: {
        components: {
          include: {
            inventoryItem: true,
          },
        },
      },
    });

    this.logger.log(`${dto.bundleType} '${dto.name}' created with ${dto.items.length} components`);
    return bundle;
  }

  async getBundle(organizationId: string, bundleId: string) {
    const bundle = await this.prisma.inventoryBundle.findFirst({
      where: { id: bundleId, organizationId },
      include: {
        components: {
          include: {
            inventoryItem: true,
          },
        },
      },
    });

    if (!bundle) {
      throw new NotFoundException('Bundle not found');
    }

    // Calculate available quantity based on component availability
    const availableQty = await this.calculateAvailableQuantity(bundle);

    return {
      ...bundle,
      availableQuantity: availableQty,
    };
  }

  async listBundles(
    organizationId: string,
    options?: { bundleType?: string; isActive?: boolean },
  ) {
    const bundles = await this.prisma.inventoryBundle.findMany({
      where: {
        organizationId,
        ...(options?.bundleType && { bundleType: options.bundleType as any }),
        ...(options?.isActive !== undefined && { isActive: options.isActive }),
      },
      include: {
        components: {
          include: {
            inventoryItem: {
              select: { id: true, sku: true, name: true, quantity: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Calculate available quantities for all bundles
    return Promise.all(
      bundles.map(async (bundle) => ({
        ...bundle,
        availableQuantity: await this.calculateAvailableQuantity(bundle),
      })),
    );
  }

  async updateBundle(
    organizationId: string,
    bundleId: string,
    dto: Partial<CreateBundleDto>,
  ) {
    const bundle = await this.getBundle(organizationId, bundleId);

    // If updating items, validate and recalculate costs
    if (dto.items) {
      const itemIds = dto.items.map((i) => i.inventoryItemId);
      const existingItems = await this.prisma.inventoryItem.findMany({
        where: { id: { in: itemIds }, organizationId },
      });

      if (existingItems.length !== itemIds.length) {
        throw new BadRequestException('One or more inventory items not found');
      }

      const itemCostMap = new Map(existingItems.map((i) => [i.id, Number(i.unitCost)]));
      const totalComponentCost = dto.items.reduce((sum, item) => {
        const unitCost = itemCostMap.get(item.inventoryItemId) || 0;
        return sum + unitCost * item.quantity;
      }, 0);

      // Delete existing items and create new ones
      await this.prisma.inventoryBundleItem.deleteMany({
        where: { bundleId },
      });

      await this.prisma.inventoryBundleItem.createMany({
        data: dto.items.map((item) => ({
          bundleId,
          inventoryItemId: item.inventoryItemId,
          quantity: item.quantity,
          unitCostAtCreation: new Prisma.Decimal(itemCostMap.get(item.inventoryItemId) || 0),
        })),
      });

      return this.prisma.inventoryBundle.update({
        where: { id: bundleId },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description && { description: dto.description }),
          ...(dto.sellingPrice && { sellingPrice: new Prisma.Decimal(dto.sellingPrice) }),
          totalComponentCost: new Prisma.Decimal(totalComponentCost),
        },
        include: { components: { include: { inventoryItem: true } } },
      });
    }

    return this.prisma.inventoryBundle.update({
      where: { id: bundleId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description && { description: dto.description }),
        ...(dto.sellingPrice && { sellingPrice: new Prisma.Decimal(dto.sellingPrice) }),
      },
      include: { components: { include: { inventoryItem: true } } },
    });
  }

  async deactivateBundle(organizationId: string, bundleId: string) {
    await this.getBundle(organizationId, bundleId);

    return this.prisma.inventoryBundle.update({
      where: { id: bundleId },
      data: { isActive: false },
    });
  }

  // Assembly Building
  async buildAssembly(organizationId: string, dto: BuildAssemblyDto, userId: string) {
    const bundle = await this.getBundle(organizationId, dto.bundleId);

    if (bundle.bundleType !== 'ASSEMBLY') {
      throw new BadRequestException('Only ASSEMBLY type bundles can be built');
    }

    // Check component availability
    const availableQty = await this.calculateAvailableQuantity(bundle);
    if (availableQty < dto.quantityToBuild) {
      throw new BadRequestException(
        `Insufficient components. Can only build ${availableQty} units.`,
      );
    }

    // Calculate costs
    const componentCosts: { itemId: string; quantity: number; cost: number }[] = [];
    let totalCost = 0;

    for (const bundleItem of bundle.components) {
      const qtyNeeded = Number(bundleItem.quantity) * dto.quantityToBuild;
      const itemCost = Number(bundleItem.inventoryItem.unitCost) * qtyNeeded;
      componentCosts.push({
        itemId: bundleItem.inventoryItemId,
        quantity: qtyNeeded,
        cost: itemCost,
      });
      totalCost += itemCost;
    }

    // Create assembly build record
    const build = await this.prisma.assemblyBuild.create({
      data: {
        organizationId,
        bundleId: dto.bundleId,
        quantityBuilt: dto.quantityToBuild,
        buildDate: dto.buildDate || new Date(),
        totalCost: new Prisma.Decimal(totalCost),
        unitCost: new Prisma.Decimal(totalCost / dto.quantityToBuild),
        status: 'COMPLETED',
        notes: dto.notes,
        completedBy: userId,
        consumedItems: {
          create: componentCosts.map((c) => ({
            inventoryItemId: c.itemId,
            quantityUsed: c.quantity,
            unitCost: new Prisma.Decimal(c.cost / c.quantity),
            totalCost: new Prisma.Decimal(c.cost),
          })),
        },
      },
      include: {
        consumedItems: {
          include: { inventoryItem: true },
        },
      },
    });

    // Deduct components from inventory
    for (const bundleItem of bundle.components) {
      const qtyToDeduct = Number(bundleItem.quantity) * dto.quantityToBuild;
      await this.prisma.inventoryItem.update({
        where: { id: bundleItem.inventoryItemId },
        data: {
          quantity: {
            decrement: qtyToDeduct,
          },
        },
      });

      // Record inventory ledger entry
      await this.prisma.inventoryLedger.create({
        data: {
          itemId: bundleItem.inventoryItemId,
          transactionType: 'ASSEMBLY_USE',
          referenceId: build.id,
          quantity: -qtyToDeduct,
          unitCost: Number(bundleItem.inventoryItem.unitCost),
          totalCost: Number(bundleItem.inventoryItem.unitCost) * qtyToDeduct,
          balanceQty: Number(bundleItem.inventoryItem.quantity) - qtyToDeduct,
          balanceCost: 0, // Will be calculated
          notes: `Used in assembly build ${build.id}`,
        },
      });
    }

    // Update bundle quantity on hand
    await this.prisma.inventoryBundle.update({
      where: { id: dto.bundleId },
      data: {
        quantityOnHand: { increment: dto.quantityToBuild },
      },
    });

    this.logger.log(
      `Built ${dto.quantityToBuild} units of assembly '${bundle.name}' (Build ID: ${build.id})`,
    );

    return build;
  }

  async getAssemblyBuilds(
    organizationId: string,
    options?: {
      bundleId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.AssemblyBuildWhereInput = {
      organizationId,
      ...(options?.bundleId && { bundleId: options.bundleId }),
      ...(options?.startDate || options?.endDate
        ? {
            buildDate: {
              ...(options?.startDate && { gte: options.startDate }),
              ...(options?.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const [builds, total] = await Promise.all([
      this.prisma.assemblyBuild.findMany({
        where,
        include: {
          bundle: { select: { sku: true, name: true } },
          consumedItems: {
            include: { inventoryItem: { select: { sku: true, name: true } } },
          },
        },
        orderBy: { buildDate: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.assemblyBuild.count({ where }),
    ]);

    return { builds, total };
  }

  // Bundle Sales (for Bundles and Kits - instant component deduction)
  async sellBundle(
    organizationId: string,
    bundleId: string,
    quantity: number,
    referenceId: string,
  ) {
    const bundle = await this.getBundle(organizationId, bundleId);

    if (bundle.bundleType === 'ASSEMBLY') {
      // For assemblies, check built quantity
      if (Number(bundle.quantityOnHand) < quantity) {
        throw new BadRequestException('Insufficient assembled quantity');
      }

      // Deduct from assembled quantity
      await this.prisma.inventoryBundle.update({
        where: { id: bundleId },
        data: {
          quantityOnHand: { decrement: quantity },
        },
      });
    } else {
      // For bundles/kits, deduct components directly
      const availableQty = await this.calculateAvailableQuantity(bundle);
      if (availableQty < quantity) {
        throw new BadRequestException('Insufficient component inventory');
      }

      // Deduct each component
      for (const bundleItem of bundle.components) {
        const qtyToDeduct = Number(bundleItem.quantity) * quantity;
        await this.prisma.inventoryItem.update({
          where: { id: bundleItem.inventoryItemId },
          data: {
            quantity: { decrement: qtyToDeduct },
          },
        });

        // Record inventory ledger entry
        await this.prisma.inventoryLedger.create({
          data: {
            itemId: bundleItem.inventoryItemId,
            transactionType: 'SALE',
            referenceId,
            quantity: -qtyToDeduct,
            unitCost: Number(bundleItem.inventoryItem.unitCost),
            totalCost: Number(bundleItem.inventoryItem.unitCost) * qtyToDeduct,
            balanceQty: Number(bundleItem.inventoryItem.quantity) - qtyToDeduct,
            balanceCost: 0,
            notes: `Sold as part of bundle ${bundle.sku}`,
          },
        });
      }
    }

    this.logger.log(`Sold ${quantity} units of bundle '${bundle.name}'`);

    return { success: true, bundleId, quantitySold: quantity };
  }

  // Helper Methods
  private async calculateAvailableQuantity(bundle: any): Promise<number> {
    if (!bundle.components || bundle.components.length === 0) {
      return 0;
    }

    // For each component, calculate how many complete bundles can be made
    const availablePerComponent = bundle.components.map((item: any) => {
      const availableQty = Number(item.inventoryItem.quantity);
      const requiredQty = item.quantity;
      return Math.floor(availableQty / requiredQty);
    });

    // The bundle availability is limited by the most constrained component
    return Math.min(...availablePerComponent);
  }
}
