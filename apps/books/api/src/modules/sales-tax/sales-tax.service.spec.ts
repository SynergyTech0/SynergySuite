import { Test, TestingModule } from '@nestjs/testing';
import { SalesTaxService } from './sales-tax.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('SalesTaxService', () => {
  let service: SalesTaxService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    salesTaxRate: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    taxAgency: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    customer: {
      findUnique: jest.fn(),
    },
    productTaxability: {
      findFirst: jest.fn(),
    },
    salesTaxLiability: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    salesTaxFiling: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesTaxService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SalesTaxService>(SalesTaxService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTaxRate', () => {
    it('should create a tax rate', async () => {
      const organizationId = 'org-1';
      const input = {
        name: 'California State Tax',
        jurisdiction: 'CA',
        jurisdictionType: 'STATE' as const,
        rate: 0.0725,
        effectiveDate: new Date('2024-01-01'),
      };

      mockPrismaService.salesTaxRate.create.mockResolvedValue({
        id: 'rate-1',
        ...input,
        organizationId,
        isActive: true,
      });

      const result = await service.createTaxRate(organizationId, input);

      expect(result.id).toBe('rate-1');
      expect(mockPrismaService.salesTaxRate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          name: input.name,
          jurisdiction: input.jurisdiction,
        }),
      });
    });
  });

  describe('calculateTax', () => {
    it('should calculate tax for taxable items', async () => {
      const organizationId = 'org-1';
      const request = {
        lineItems: [
          { amount: 100, isTaxable: true },
          { amount: 50, isTaxable: true },
        ],
        shipToAddress: {
          state: 'CA',
          zipCode: '90210',
        },
      };

      mockPrismaService.salesTaxRate.findMany.mockResolvedValue([
        {
          id: 'rate-1',
          name: 'California State Tax',
          jurisdiction: 'CA',
          jurisdictionType: 'STATE',
          rate: 0.0725,
          isCompound: false,
          isActive: true,
          effectiveDate: new Date('2024-01-01'),
          zipCodes: [],
        },
      ]);

      mockPrismaService.customer.findUnique.mockResolvedValue(null);
      mockPrismaService.productTaxability.findFirst.mockResolvedValue(null);

      const result = await service.calculateTax(organizationId, request);

      expect(result.subtotal).toBe(150);
      expect(result.taxableAmount).toBe(150);
      expect(result.totalTax).toBeCloseTo(10.88, 2);
      expect(result.total).toBeCloseTo(160.88, 2);
    });

    it('should exclude tax-exempt customers', async () => {
      const organizationId = 'org-1';
      const request = {
        lineItems: [{ amount: 100 }],
        shipToAddress: { state: 'CA' },
        customerId: 'cust-1',
      };

      mockPrismaService.salesTaxRate.findMany.mockResolvedValue([
        {
          id: 'rate-1',
          rate: 0.0725,
          isCompound: false,
          isActive: true,
          effectiveDate: new Date('2024-01-01'),
          zipCodes: [],
        },
      ]);

      mockPrismaService.customer.findUnique.mockResolvedValue({
        taxExempt: true,
      });

      const result = await service.calculateTax(organizationId, request);

      expect(result.taxableAmount).toBe(0);
      expect(result.exemptAmount).toBe(100);
      expect(result.totalTax).toBe(0);
    });

    it('should handle compound tax rates', async () => {
      const organizationId = 'org-1';
      const request = {
        lineItems: [{ amount: 100 }],
        shipToAddress: { state: 'CA' },
      };

      mockPrismaService.salesTaxRate.findMany.mockResolvedValue([
        {
          id: 'rate-1',
          name: 'State Tax',
          jurisdiction: 'CA',
          rate: 0.05,
          isCompound: false,
          isActive: true,
          effectiveDate: new Date('2024-01-01'),
          zipCodes: [],
        },
        {
          id: 'rate-2',
          name: 'County Tax',
          jurisdiction: 'Los Angeles',
          rate: 0.025,
          isCompound: true,
          isActive: true,
          effectiveDate: new Date('2024-01-01'),
          zipCodes: [],
        },
      ]);

      mockPrismaService.customer.findUnique.mockResolvedValue(null);
      mockPrismaService.productTaxability.findFirst.mockResolvedValue(null);

      const result = await service.calculateTax(organizationId, request);

      expect(result.subtotal).toBe(100);
      expect(result.totalTax).toBeGreaterThan(5);
      expect(result.taxes).toHaveLength(2);
    });
  });

  describe('recordTaxLiability', () => {
    it('should create new liability if none exists', async () => {
      const organizationId = 'org-1';
      const agencyId = 'agency-1';
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');
      const taxableAmount = 1000;
      const taxCollected = 75;

      mockPrismaService.taxAgency.findFirst.mockResolvedValue({
        id: agencyId,
        filingFrequency: 'MONTHLY',
        dueDayOfMonth: 15,
      });

      mockPrismaService.salesTaxLiability.findFirst.mockResolvedValue(null);
      mockPrismaService.salesTaxLiability.create.mockResolvedValue({
        id: 'liability-1',
        organizationId,
        agencyId,
        taxableSales: taxableAmount,
        taxCollected,
      });

      const result = await service.recordTaxLiability(
        organizationId,
        agencyId,
        periodStart,
        periodEnd,
        taxableAmount,
        taxCollected,
      );

      expect(result.id).toBe('liability-1');
      expect(mockPrismaService.salesTaxLiability.create).toHaveBeenCalled();
    });

    it('should update existing liability', async () => {
      const organizationId = 'org-1';
      const agencyId = 'agency-1';
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');

      mockPrismaService.taxAgency.findFirst.mockResolvedValue({
        id: agencyId,
        filingFrequency: 'MONTHLY',
      });

      mockPrismaService.salesTaxLiability.findFirst.mockResolvedValue({
        id: 'liability-1',
        taxableSales: 500,
        taxCollected: 37.5,
      });

      mockPrismaService.salesTaxLiability.update.mockResolvedValue({
        id: 'liability-1',
        taxableSales: 600,
        taxCollected: 45,
      });

      const result = await service.recordTaxLiability(
        organizationId,
        agencyId,
        periodStart,
        periodEnd,
        100,
        7.5,
      );

      expect(mockPrismaService.salesTaxLiability.update).toHaveBeenCalled();
    });
  });

  describe('fileTaxReturn', () => {
    it('should file tax return and update liability', async () => {
      const organizationId = 'org-1';
      const liabilityId = 'liability-1';
      const filingData = {
        filedBy: 'John Doe',
        filingMethod: 'online',
        confirmationNumber: 'CONF123',
        paymentAmount: 75,
        paymentMethod: 'ACH',
      };

      mockPrismaService.salesTaxLiability.findFirst.mockResolvedValue({
        id: liabilityId,
        agencyId: 'agency-1',
        amountDue: 75,
      });

      mockPrismaService.salesTaxFiling.create.mockResolvedValue({
        id: 'filing-1',
        liabilityId,
      });

      mockPrismaService.salesTaxLiability.update.mockResolvedValue({
        id: liabilityId,
        status: 'PAID',
      });

      const result = await service.fileTaxReturn(organizationId, liabilityId, filingData);

      expect(result.id).toBe('filing-1');
      expect(mockPrismaService.salesTaxFiling.create).toHaveBeenCalled();
      expect(mockPrismaService.salesTaxLiability.update).toHaveBeenCalledWith({
        where: { id: liabilityId },
        data: expect.objectContaining({
          status: 'PAID',
        }),
      });
    });

    it('should throw NotFoundException if liability not found', async () => {
      mockPrismaService.salesTaxLiability.findFirst.mockResolvedValue(null);

      await expect(
        service.fileTaxReturn('org-1', 'invalid-id', {
          filedBy: 'John',
          filingMethod: 'online',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
