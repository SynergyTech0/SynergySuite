import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export type AssetType = 'BUILDING' | 'EQUIPMENT' | 'VEHICLE' | 'COMPUTER_EQUIPMENT' | 'FURNITURE' | 'SOFTWARE' | 'LAND' | 'LEASEHOLD_IMPROVEMENT' | 'OTHER';
export type DepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'DOUBLE_DECLINING' | 'MACRS_GDS' | 'MACRS_ADS' | 'SECTION_179' | 'NO_DEPRECIATION';

export interface CreateAssetInput {
  assetNumber: string;
  name: string;
  description?: string;
  assetType: AssetType;
  acquisitionDate: Date;
  acquisitionCost: number;
  acquisitionMethod?: string;
  vendorId?: string;
  location?: string;
  department?: string;
  serialNumber?: string;
  salvageValue?: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  macrsClass?: string;
  section179Amount?: number;
  assetAccountId: string;
  accumulatedDepAccountId: string;
  depreciationExpenseAccountId: string;
  gainLossAccountId?: string;
}

@Injectable()
export class FixedAssetsService {
  private readonly logger = new Logger(FixedAssetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAsset(organizationId: string, input: CreateAssetInput) {
    const asset = await this.prisma.fixedAsset.create({
      data: {
        organizationId,
        assetNumber: input.assetNumber,
        name: input.name,
        description: input.description,
        assetType: input.assetType,
        status: 'ACTIVE',
        acquisitionDate: input.acquisitionDate,
        acquisitionCost: new Prisma.Decimal(input.acquisitionCost),
        acquisitionMethod: input.acquisitionMethod,
        vendorId: input.vendorId,
        location: input.location,
        department: input.department,
        serialNumber: input.serialNumber,
        currentBookValue: new Prisma.Decimal(input.acquisitionCost),
        accumulatedDepreciation: new Prisma.Decimal(0),
        accounts: {
          create: {
            assetAccountId: input.assetAccountId,
            accumulatedDepAccountId: input.accumulatedDepAccountId,
            depreciationExpenseAccountId: input.depreciationExpenseAccountId,
            gainLossAccountId: input.gainLossAccountId,
          },
        },
        depreciation: {
          create: {
            method: input.depreciationMethod,
            usefulLifeMonths: input.usefulLifeMonths,
            salvageValue: new Prisma.Decimal(input.salvageValue || 0),
            macrsClass: input.macrsClass,
            section179Amount: input.section179Amount ? new Prisma.Decimal(input.section179Amount) : null,
            startDate: input.acquisitionDate,
            isActive: true,
          },
        },
      },
      include: { accounts: true, depreciation: true },
    });

    return asset;
  }

  async getAssets(organizationId: string, options?: { status?: string; assetType?: string }) {
    return this.prisma.fixedAsset.findMany({
      where: {
        organizationId,
        ...(options?.status && { status: options.status as any }),
        ...(options?.assetType && { assetType: options.assetType as any }),
      },
      include: { accounts: true, depreciation: true },
      orderBy: { acquisitionDate: 'desc' },
    });
  }

  async getAsset(organizationId: string, assetId: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id: assetId, organizationId },
      include: { accounts: true, depreciation: true, entries: { orderBy: { periodDate: 'desc' } } },
    });

    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async updateAsset(organizationId: string, assetId: string, updates: Partial<CreateAssetInput>) {
    const asset = await this.getAsset(organizationId, assetId);
    
    return this.prisma.fixedAsset.update({
      where: { id: assetId },
      data: {
        ...(updates.name && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.location !== undefined && { location: updates.location }),
        ...(updates.department !== undefined && { department: updates.department }),
        ...(updates.serialNumber !== undefined && { serialNumber: updates.serialNumber }),
      },
      include: { accounts: true, depreciation: true },
    });
  }

  async calculateDepreciation(organizationId: string, assetId: string, periodDate: Date) {
    const asset = await this.getAsset(organizationId, assetId);
    if (!asset.depreciation) throw new BadRequestException('No depreciation schedule');
    if (asset.status !== 'ACTIVE') throw new BadRequestException('Asset is not active');

    const { depreciation } = asset;
    const acquisitionCost = Number(asset.acquisitionCost);
    const salvageValue = Number(depreciation.salvageValue);
    const usefulLifeMonths = depreciation.usefulLifeMonths;
    const currentAccumulated = Number(asset.accumulatedDepreciation);
    const depreciableBase = acquisitionCost - salvageValue;

    let depreciationAmount = 0;

    switch (depreciation.method) {
      case 'STRAIGHT_LINE':
        depreciationAmount = depreciableBase / usefulLifeMonths;
        break;
      case 'DOUBLE_DECLINING':
        const rate = 2 / usefulLifeMonths;
        const bookValue = acquisitionCost - currentAccumulated;
        depreciationAmount = Math.min(bookValue * rate, bookValue - salvageValue);
        break;
      case 'MACRS_GDS':
        depreciationAmount = this.calculateMACRS(asset, periodDate);
        break;
      default:
        depreciationAmount = depreciableBase / usefulLifeMonths;
    }

    // Don't exceed depreciable amount
    const maxDepreciation = depreciableBase - currentAccumulated;
    depreciationAmount = Math.min(Math.max(depreciationAmount, 0), maxDepreciation);

    const newAccumulated = currentAccumulated + depreciationAmount;
    const newBookValue = acquisitionCost - newAccumulated;

    // Create depreciation entry
    const entry = await this.prisma.depreciationEntry.create({
      data: {
        assetId,
        periodDate,
        periodType: 'MONTH',
        depreciationAmount: new Prisma.Decimal(depreciationAmount),
        accumulatedTotal: new Prisma.Decimal(newAccumulated),
        bookValue: new Prisma.Decimal(newBookValue),
        calculationMethod: depreciation.method,
        isPosted: false,
      },
    });

    // Update asset
    await this.prisma.fixedAsset.update({
      where: { id: assetId },
      data: {
        accumulatedDepreciation: new Prisma.Decimal(newAccumulated),
        currentBookValue: new Prisma.Decimal(newBookValue),
        ...(newBookValue <= salvageValue && { status: 'FULLY_DEPRECIATED' }),
      },
    });

    return entry;
  }

  private calculateMACRS(asset: any, periodDate: Date): number {
    const macrsRates: Record<string, number[]> = {
      '3': [0.3333, 0.4445, 0.1481, 0.0741],
      '5': [0.20, 0.32, 0.192, 0.1152, 0.1152, 0.0576],
      '7': [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446],
    };

    const macrsClass = asset.depreciation?.macrsClass || '5';
    const rates = macrsRates[macrsClass] || macrsRates['5'];
    const acquisitionDate = new Date(asset.acquisitionDate);
    const yearsSinceAcquisition = Math.floor(
      (periodDate.getTime() - acquisitionDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    );

    if (yearsSinceAcquisition >= rates.length) return 0;

    const annualRate = rates[yearsSinceAcquisition];
    return (Number(asset.acquisitionCost) * annualRate) / 12;
  }

  async runMonthlyDepreciation(organizationId: string, periodDate: Date) {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: { depreciation: true },
    });

    const results = [];
    for (const asset of assets) {
      if (asset.depreciation?.method !== 'NO_DEPRECIATION') {
        try {
          const entry = await this.calculateDepreciation(organizationId, asset.id, periodDate);
          results.push({ assetId: asset.id, success: true, entry });
        } catch (error) {
          results.push({ assetId: asset.id, success: false, error: (error as Error).message });
        }
      }
    }

    return { processed: results.length, results };
  }

  async disposeAsset(
    organizationId: string,
    assetId: string,
    disposal: {
      disposalDate: Date;
      disposalMethod: string;
      salePrice?: number;
      saleExpenses?: number;
      buyerName?: string;
      notes?: string;
    },
  ) {
    const asset = await this.getAsset(organizationId, assetId);
    if (asset.status !== 'ACTIVE' && asset.status !== 'FULLY_DEPRECIATED') {
      throw new BadRequestException('Asset cannot be disposed');
    }

    const bookValue = Number(asset.currentBookValue);
    const netProceeds = (disposal.salePrice || 0) - (disposal.saleExpenses || 0);
    const gainLoss = netProceeds - bookValue;

    await this.prisma.assetDisposal.create({
      data: {
        assetId,
        disposalDate: disposal.disposalDate,
        disposalMethod: disposal.disposalMethod as any,
        salePrice: disposal.salePrice ? new Prisma.Decimal(disposal.salePrice) : null,
        saleExpenses: disposal.saleExpenses ? new Prisma.Decimal(disposal.saleExpenses) : null,
        netProceeds: new Prisma.Decimal(netProceeds),
        buyerName: disposal.buyerName,
        bookValueAtDisposal: new Prisma.Decimal(bookValue),
        accumulatedDepAtDisposal: asset.accumulatedDepreciation,
        gainLoss: new Prisma.Decimal(gainLoss),
        isOrdinaryIncome: false,
        notes: disposal.notes,
      },
    });

    await this.prisma.fixedAsset.update({
      where: { id: assetId },
      data: { status: disposal.disposalMethod === 'SALE' ? 'SOLD' : 'DISPOSED' },
    });

    return { assetId, bookValue, netProceeds, gainLoss };
  }

  async getDepreciationSchedule(organizationId: string, assetId: string) {
    const asset = await this.getAsset(organizationId, assetId);
    const entries = await this.prisma.depreciationEntry.findMany({
      where: { assetId },
      orderBy: { periodDate: 'asc' },
    });

    return {
      asset: {
        id: asset.id,
        name: asset.name,
        acquisitionCost: asset.acquisitionCost,
        salvageValue: asset.depreciation?.salvageValue,
        usefulLifeMonths: asset.depreciation?.usefulLifeMonths,
        method: asset.depreciation?.method,
      },
      entries,
    };
  }

  async getAssetSummary(organizationId: string) {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId },
      include: { depreciation: true },
    });

    const summary = {
      totalAssets: assets.length,
      activeAssets: assets.filter(a => a.status === 'ACTIVE').length,
      fullyDepreciated: assets.filter(a => a.status === 'FULLY_DEPRECIATED').length,
      disposed: assets.filter(a => a.status === 'SOLD' || a.status === 'DISPOSED').length,
      totalAcquisitionCost: 0,
      totalAccumulatedDepreciation: 0,
      totalBookValue: 0,
      byType: {} as Record<string, { count: number; acquisitionCost: number; bookValue: number }>,
      byMethod: {} as Record<string, { count: number; acquisitionCost: number }>,
    };

    for (const asset of assets) {
      const cost = Number(asset.acquisitionCost);
      const accumulated = Number(asset.accumulatedDepreciation);
      const bookValue = Number(asset.currentBookValue);

      summary.totalAcquisitionCost += cost;
      summary.totalAccumulatedDepreciation += accumulated;
      summary.totalBookValue += bookValue;

      // By type
      if (!summary.byType[asset.assetType]) {
        summary.byType[asset.assetType] = { count: 0, acquisitionCost: 0, bookValue: 0 };
      }
      summary.byType[asset.assetType].count++;
      summary.byType[asset.assetType].acquisitionCost += cost;
      summary.byType[asset.assetType].bookValue += bookValue;

      // By method
      const method = asset.depreciation?.method || 'NONE';
      if (!summary.byMethod[method]) {
        summary.byMethod[method] = { count: 0, acquisitionCost: 0 };
      }
      summary.byMethod[method].count++;
      summary.byMethod[method].acquisitionCost += cost;
    }

    return summary;
  }

  async getDepreciationForecast(organizationId: string, months: number = 12) {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: { depreciation: true },
    });

    const forecast: Array<{
      month: string;
      totalDepreciation: number;
      assetCount: number;
      byMethod: Record<string, number>;
    }> = [];

    const startDate = new Date();
    
    for (let i = 0; i < months; i++) {
      const periodDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const monthKey = periodDate.toISOString().substring(0, 7);

      let totalDepreciation = 0;
      const byMethod: Record<string, number> = {};
      let assetCount = 0;

      for (const asset of assets) {
        if (asset.depreciation?.method === 'NO_DEPRECIATION') continue;

        const monthlyDepreciation = this.estimateMonthlyDepreciation(asset, periodDate);
        if (monthlyDepreciation > 0) {
          totalDepreciation += monthlyDepreciation;
          assetCount++;

          const method = asset.depreciation?.method || 'STRAIGHT_LINE';
          byMethod[method] = (byMethod[method] || 0) + monthlyDepreciation;
        }
      }

      forecast.push({
        month: monthKey,
        totalDepreciation,
        assetCount,
        byMethod,
      });
    }

    return {
      forecastMonths: months,
      forecast,
      totalProjectedDepreciation: forecast.reduce((sum, m) => sum + m.totalDepreciation, 0),
    };
  }

  private estimateMonthlyDepreciation(asset: any, periodDate: Date): number {
    if (!asset.depreciation) return 0;

    const acquisitionCost = Number(asset.acquisitionCost);
    const salvageValue = Number(asset.depreciation.salvageValue);
    const currentAccumulated = Number(asset.accumulatedDepreciation);
    const depreciableBase = acquisitionCost - salvageValue;
    const remainingDepreciable = depreciableBase - currentAccumulated;

    if (remainingDepreciable <= 0) return 0;

    switch (asset.depreciation.method) {
      case 'STRAIGHT_LINE':
        return Math.min(
          depreciableBase / asset.depreciation.usefulLifeMonths,
          remainingDepreciable
        );
      case 'DOUBLE_DECLINING':
        const rate = 2 / asset.depreciation.usefulLifeMonths;
        const bookValue = acquisitionCost - currentAccumulated;
        return Math.min(bookValue * rate, remainingDepreciable);
      case 'MACRS_GDS':
        return this.calculateMACRS(asset, periodDate);
      default:
        return Math.min(
          depreciableBase / asset.depreciation.usefulLifeMonths,
          remainingDepreciable
        );
    }
  }
}
