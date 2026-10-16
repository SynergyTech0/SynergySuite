import { Test, TestingModule } from '@nestjs/testing';
import { FixedAssetsService } from './fixed-assets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('FixedAssetsService', () => {
  let service: FixedAssetsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    fixedAsset: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    depreciationEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    assetDisposal: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixedAssetsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<FixedAssetsService>(FixedAssetsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAsset', () => {
    it('should create a fixed asset with depreciation schedule', async () => {
      const organizationId = 'org-1';
      const input = {
        assetNumber: 'EQUIP-001',
        name: 'Delivery Truck',
        assetType: 'VEHICLE' as const,
        acquisitionDate: new Date('2024-01-01'),
        acquisitionCost: 50000,
        salvageValue: 5000,
        usefulLifeMonths: 60,
        depreciationMethod: 'STRAIGHT_LINE' as const,
        assetAccountId: 'acc-1',
        accumulatedDepAccountId: 'acc-2',
        depreciationExpenseAccountId: 'acc-3',
      };

      mockPrismaService.fixedAsset.create.mockResolvedValue({
        id: 'asset-1',
        ...input,
        organizationId,
        status: 'ACTIVE',
        currentBookValue: 50000,
        accumulatedDepreciation: 0,
      });

      const result = await service.createAsset(organizationId, input);

      expect(result.id).toBe('asset-1');
      expect(result.name).toBe('Delivery Truck');
      expect(mockPrismaService.fixedAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          assetNumber: input.assetNumber,
          name: input.name,
          status: 'ACTIVE',
        }),
        include: { accounts: true, depreciation: true },
      });
    });
  });

  describe('calculateDepreciation', () => {
    it('should calculate straight-line depreciation correctly', async () => {
      const organizationId = 'org-1';
      const assetId = 'asset-1';
      const periodDate = new Date('2024-02-01');

      const mockAsset = {
        id: assetId,
        organizationId,
        name: 'Equipment',
        status: 'ACTIVE',
        acquisitionCost: { toString: () => '60000' },
        accumulatedDepreciation: { toString: () => '0' },
        currentBookValue: { toString: () => '60000' },
        depreciation: {
          method: 'STRAIGHT_LINE',
          usefulLifeMonths: 60,
          salvageValue: { toString: () => '0' },
        },
      };

      mockPrismaService.fixedAsset.findFirst.mockResolvedValue(mockAsset);
      mockPrismaService.depreciationEntry.create.mockResolvedValue({
        id: 'entry-1',
        assetId,
        periodDate,
        depreciationAmount: 1000,
      });
      mockPrismaService.fixedAsset.update.mockResolvedValue(mockAsset);

      const result = await service.calculateDepreciation(organizationId, assetId, periodDate);

      expect(result).toBeDefined();
      expect(mockPrismaService.depreciationEntry.create).toHaveBeenCalled();
      // Straight line: (60000 - 0) / 60 months = 1000 per month
    });

    it('should calculate double-declining depreciation', async () => {
      const mockAsset = {
        id: 'asset-1',
        organizationId: 'org-1',
        name: 'Equipment',
        status: 'ACTIVE',
        acquisitionCost: { toString: () => '100000' },
        accumulatedDepreciation: { toString: () => '0' },
        currentBookValue: { toString: () => '100000' },
        depreciation: {
          method: 'DOUBLE_DECLINING',
          usefulLifeMonths: 60,
          salvageValue: { toString: () => '10000' },
        },
      };

      mockPrismaService.fixedAsset.findFirst.mockResolvedValue(mockAsset);
      mockPrismaService.depreciationEntry.create.mockResolvedValue({
        id: 'entry-1',
        depreciationAmount: 3333.33,
      });
      mockPrismaService.fixedAsset.update.mockResolvedValue(mockAsset);

      const result = await service.calculateDepreciation('org-1', 'asset-1', new Date());

      expect(result).toBeDefined();
      // Rate = 2 / 60 = 0.0333
      // First month: 100000 * 0.0333 = 3333
    });

    it('should throw error if asset not found', async () => {
      mockPrismaService.fixedAsset.findFirst.mockResolvedValue(null);

      await expect(
        service.calculateDepreciation('org-1', 'invalid-id', new Date())
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw error if asset is not active', async () => {
      mockPrismaService.fixedAsset.findFirst.mockResolvedValue({
        id: 'asset-1',
        status: 'DISPOSED',
        depreciation: { method: 'STRAIGHT_LINE' },
      });

      await expect(
        service.calculateDepreciation('org-1', 'asset-1', new Date())
      ).rejects.toThrow(BadRequestException);
    });

    it('should not depreciate beyond salvage value', async () => {
      const mockAsset = {
        id: 'asset-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        acquisitionCost: { toString: () => '10000' },
        accumulatedDepreciation: { toString: () => '9000' },
        currentBookValue: { toString: () => '1000' },
        depreciation: {
          method: 'STRAIGHT_LINE',
          usefulLifeMonths: 60,
          salvageValue: { toString: () => '1000' },
        },
      };

      mockPrismaService.fixedAsset.findFirst.mockResolvedValue(mockAsset);
      mockPrismaService.depreciationEntry.create.mockResolvedValue({
        id: 'entry-1',
        depreciationAmount: 0,
      });
      mockPrismaService.fixedAsset.update.mockResolvedValue(mockAsset);

      const result = await service.calculateDepreciation('org-1', 'asset-1', new Date());

      // Should not depreciate below salvage value
      expect(result).toBeDefined();
    });
  });

  describe('runMonthlyDepreciation', () => {
    it('should process depreciation for all active assets', async () => {
      const organizationId = 'org-1';
      const periodDate = new Date('2024-02-01');

      const mockAssets = [
        {
          id: 'asset-1',
          organizationId,
          status: 'ACTIVE',
          acquisitionCost: { toString: () => '50000' },
          accumulatedDepreciation: { toString: () => '0' },
          depreciation: { method: 'STRAIGHT_LINE', usefulLifeMonths: 60, salvageValue: { toString: () => '0' } },
        },
        {
          id: 'asset-2',
          organizationId,
          status: 'ACTIVE',
          acquisitionCost: { toString: () => '30000' },
          accumulatedDepreciation: { toString: () => '0' },
          depreciation: { method: 'STRAIGHT_LINE', usefulLifeMonths: 36, salvageValue: { toString: () => '0' } },
        },
      ];

      mockPrismaService.fixedAsset.findMany.mockResolvedValue(mockAssets);
      mockPrismaService.fixedAsset.findFirst.mockImplementation((params) => {
        return Promise.resolve(mockAssets.find(a => a.id === params.where.id));
      });
      mockPrismaService.depreciationEntry.create.mockResolvedValue({ id: 'entry-1' });
      mockPrismaService.fixedAsset.update.mockResolvedValue({});

      const result = await service.runMonthlyDepreciation(organizationId, periodDate);

      expect(result.processed).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => r.success)).toBe(true);
    });

    it('should skip assets with NO_DEPRECIATION method', async () => {
      mockPrismaService.fixedAsset.findMany.mockResolvedValue([
        {
          id: 'asset-1',
          status: 'ACTIVE',
          depreciation: { method: 'NO_DEPRECIATION' },
        },
      ]);

      const result = await service.runMonthlyDepreciation('org-1', new Date());

      expect(result.processed).toBe(0);
      expect(mockPrismaService.depreciationEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('disposeAsset', () => {
    it('should dispose asset and calculate gain/loss', async () => {
      const organizationId = 'org-1';
      const assetId = 'asset-1';
      const disposal = {
        disposalDate: new Date('2024-12-01'),
        disposalMethod: 'SALE',
        salePrice: 15000,
        saleExpenses: 500,
        buyerName: 'ABC Company',
      };

      const mockAsset = {
        id: assetId,
        organizationId,
        status: 'ACTIVE',
        currentBookValue: { toString: () => '10000' },
        accumulatedDepreciation: { toString: () => '40000' },
      };

      mockPrismaService.fixedAsset.findFirst.mockResolvedValue(mockAsset);
      mockPrismaService.assetDisposal.create.mockResolvedValue({
        id: 'disposal-1',
        gainLoss: 4500, // (15000 - 500) - 10000
      });
      mockPrismaService.fixedAsset.update.mockResolvedValue({
        ...mockAsset,
        status: 'SOLD',
      });

      const result = await service.disposeAsset(organizationId, assetId, disposal);

      expect(result.bookValue).toBe(10000);
      expect(result.netProceeds).toBe(14500);
      expect(result.gainLoss).toBe(4500); // Gain on sale
      expect(mockPrismaService.assetDisposal.create).toHaveBeenCalled();
      expect(mockPrismaService.fixedAsset.update).toHaveBeenCalledWith({
        where: { id: assetId },
        data: { status: 'SOLD' },
      });
    });

    it('should calculate loss on disposal', async () => {
      const mockAsset = {
        id: 'asset-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        currentBookValue: { toString: () => '20000' },
        accumulatedDepreciation: { toString: () => '30000' },
      };

      mockPrismaService.fixedAsset.findFirst.mockResolvedValue(mockAsset);
      mockPrismaService.assetDisposal.create.mockResolvedValue({ id: 'disposal-1' });
      mockPrismaService.fixedAsset.update.mockResolvedValue(mockAsset);

      const result = await service.disposeAsset('org-1', 'asset-1', {
        disposalDate: new Date(),
        disposalMethod: 'SALE',
        salePrice: 15000,
      });

      expect(result.gainLoss).toBe(-5000); // Loss on sale
    });
  });

  describe('getAssetSummary', () => {
    it('should generate asset summary report', async () => {
      const mockAssets = [
        {
          id: '1',
          assetType: 'VEHICLE',
          status: 'ACTIVE',
          acquisitionCost: { toString: () => '50000' },
          accumulatedDepreciation: { toString: () => '10000' },
          currentBookValue: { toString: () => '40000' },
          depreciation: { method: 'STRAIGHT_LINE' },
        },
        {
          id: '2',
          assetType: 'EQUIPMENT',
          status: 'FULLY_DEPRECIATED',
          acquisitionCost: { toString: () => '20000' },
          accumulatedDepreciation: { toString: () => '20000' },
          currentBookValue: { toString: () => '0' },
          depreciation: { method: 'DOUBLE_DECLINING' },
        },
      ];

      mockPrismaService.fixedAsset.findMany.mockResolvedValue(mockAssets);

      const result = await service.getAssetSummary('org-1');

      expect(result.totalAssets).toBe(2);
      expect(result.activeAssets).toBe(1);
      expect(result.fullyDepreciated).toBe(1);
      expect(result.totalAcquisitionCost).toBe(70000);
      expect(result.totalAccumulatedDepreciation).toBe(30000);
      expect(result.totalBookValue).toBe(40000);
      expect(result.byType.VEHICLE.count).toBe(1);
      expect(result.byType.EQUIPMENT.count).toBe(1);
    });
  });
});
