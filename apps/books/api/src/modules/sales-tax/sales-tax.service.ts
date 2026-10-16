import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface TaxRateInput {
  name: string;
  jurisdiction: string;
  jurisdictionType: 'FEDERAL' | 'STATE' | 'COUNTY' | 'CITY' | 'DISTRICT' | 'SPECIAL';
  rate: number;
  isCompound?: boolean;
  effectiveDate: Date;
  endDate?: Date;
  zipCodes?: string[];
  countyFips?: string;
  stateFips?: string;
}

export interface TaxAgencyInput {
  name: string;
  jurisdiction: string;
  jurisdictionType: 'FEDERAL' | 'STATE' | 'COUNTY' | 'CITY' | 'DISTRICT' | 'SPECIAL';
  filingFrequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY' | 'SEMIANNUALLY';
  accountNumber?: string;
  filingMethod?: string;
  paymentMethod?: string;
  dueDayOfMonth?: number;
  gracePeriodDays?: number;
  liabilityAccountId?: string;
  expenseAccountId?: string;
  website?: string;
  phone?: string;
}

export interface TaxCalculationRequest {
  lineItems: Array<{
    amount: number;
    isTaxable?: boolean;
    productCategory?: string;
    inventoryItemId?: string;
  }>;
  shipToAddress: {
    state?: string;
    city?: string;
    county?: string;
    zipCode?: string;
  };
  customerId?: string;
  transactionDate?: Date;
}

export interface TaxCalculationResult {
  subtotal: number;
  taxableAmount: number;
  exemptAmount: number;
  taxes: Array<{
    taxRateId: string;
    name: string;
    jurisdiction: string;
    rate: number;
    taxableAmount: number;
    taxAmount: number;
  }>;
  totalTax: number;
  total: number;
}

@Injectable()
export class SalesTaxService {
  private readonly logger = new Logger(SalesTaxService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Tax Rates
  async createTaxRate(organizationId: string, input: TaxRateInput) {
    return this.prisma.salesTaxRate.create({
      data: {
        organizationId,
        name: input.name,
        jurisdiction: input.jurisdiction,
        jurisdictionType: input.jurisdictionType,
        rate: new Prisma.Decimal(input.rate),
        isCompound: input.isCompound || false,
        effectiveDate: input.effectiveDate,
        endDate: input.endDate,
        zipCodes: input.zipCodes || [],
        countyFips: input.countyFips,
        stateFips: input.stateFips,
        isActive: true,
      },
    });
  }

  async getTaxRates(organizationId: string, options?: { jurisdiction?: string; isActive?: boolean }) {
    return this.prisma.salesTaxRate.findMany({
      where: {
        organizationId,
        ...(options?.jurisdiction && { jurisdiction: options.jurisdiction }),
        ...(options?.isActive !== undefined && { isActive: options.isActive }),
      },
      orderBy: { jurisdiction: 'asc' },
    });
  }

  async updateTaxRate(organizationId: string, taxRateId: string, updates: Partial<TaxRateInput>) {
    const existing = await this.prisma.salesTaxRate.findFirst({
      where: { id: taxRateId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('Tax rate not found');
    }

    return this.prisma.salesTaxRate.update({
      where: { id: taxRateId },
      data: {
        ...(updates.name && { name: updates.name }),
        ...(updates.rate !== undefined && { rate: new Prisma.Decimal(updates.rate) }),
        ...(updates.effectiveDate && { effectiveDate: updates.effectiveDate }),
        ...(updates.endDate && { endDate: updates.endDate }),
        ...(updates.zipCodes && { zipCodes: updates.zipCodes }),
      },
    });
  }

  async deactivateTaxRate(organizationId: string, taxRateId: string) {
    const existing = await this.prisma.salesTaxRate.findFirst({
      where: { id: taxRateId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('Tax rate not found');
    }

    return this.prisma.salesTaxRate.update({
      where: { id: taxRateId },
      data: { isActive: false, endDate: new Date() },
    });
  }

  // Tax Agencies
  async createTaxAgency(organizationId: string, input: TaxAgencyInput) {
    return this.prisma.taxAgency.create({
      data: {
        organizationId,
        name: input.name,
        jurisdiction: input.jurisdiction,
        jurisdictionType: input.jurisdictionType,
        filingFrequency: input.filingFrequency,
        accountNumber: input.accountNumber,
        filingMethod: input.filingMethod,
        paymentMethod: input.paymentMethod,
        dueDayOfMonth: input.dueDayOfMonth,
        gracePeriodDays: input.gracePeriodDays || 0,
        liabilityAccountId: input.liabilityAccountId,
        expenseAccountId: input.expenseAccountId,
        website: input.website,
        phone: input.phone,
        isActive: true,
      },
    });
  }

  async getTaxAgencies(organizationId: string) {
    return this.prisma.taxAgency.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // Tax Calculation
  async calculateTax(organizationId: string, request: TaxCalculationRequest): Promise<TaxCalculationResult> {
    const transactionDate = request.transactionDate || new Date();

    // Get applicable tax rates based on location
    const taxRates = await this.getApplicableTaxRates(
      organizationId,
      request.shipToAddress,
      transactionDate,
    );

    // Check if customer is tax exempt
    let customerExempt = false;
    if (request.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: request.customerId },
        select: { taxExempt: true },
      });
      customerExempt = customer?.taxExempt || false;
    }

    let subtotal = 0;
    let taxableAmount = 0;
    let exemptAmount = 0;

    // Calculate taxable amounts for each line
    for (const line of request.lineItems) {
      subtotal += line.amount;

      if (customerExempt || line.isTaxable === false) {
        exemptAmount += line.amount;
      } else {
        // Check product-specific taxability
        const productTaxable = await this.isProductTaxable(
          organizationId,
          line.inventoryItemId,
          line.productCategory,
        );

        if (productTaxable) {
          taxableAmount += line.amount;
        } else {
          exemptAmount += line.amount;
        }
      }
    }

    // Calculate taxes for each applicable rate
    const taxes: TaxCalculationResult['taxes'] = [];
    let totalTax = 0;
    let compoundBase = taxableAmount;

    // Sort rates: non-compound first, then compound
    const sortedRates = taxRates.sort((a, b) => {
      if (a.isCompound && !b.isCompound) return 1;
      if (!a.isCompound && b.isCompound) return -1;
      return 0;
    });

    for (const rate of sortedRates) {
      const rateValue = Number(rate.rate);
      const base = rate.isCompound ? compoundBase : taxableAmount;
      const taxAmount = Math.round(base * rateValue * 100) / 100;

      taxes.push({
        taxRateId: rate.id,
        name: rate.name,
        jurisdiction: rate.jurisdiction,
        rate: rateValue,
        taxableAmount: base,
        taxAmount,
      });

      totalTax += taxAmount;

      if (rate.isCompound) {
        compoundBase += taxAmount;
      }
    }

    return {
      subtotal,
      taxableAmount,
      exemptAmount,
      taxes,
      totalTax,
      total: subtotal + totalTax,
    };
  }

  private async getApplicableTaxRates(
    organizationId: string,
    address: TaxCalculationRequest['shipToAddress'],
    transactionDate: Date,
  ) {
    const rates = await this.prisma.salesTaxRate.findMany({
      where: {
        organizationId,
        isActive: true,
        effectiveDate: { lte: transactionDate },
        OR: [
          { endDate: null },
          { endDate: { gte: transactionDate } },
        ],
      },
    });

    // Filter by location match
    return rates.filter((rate) => {
      // Match by ZIP code if specified
      if (rate.zipCodes.length > 0 && address.zipCode) {
        if (rate.zipCodes.includes(address.zipCode)) return true;
      }

      // Match by state
      if (rate.jurisdictionType === 'STATE' && address.state) {
        if (rate.jurisdiction.toUpperCase() === address.state.toUpperCase()) return true;
      }

      // Match by county
      if (rate.jurisdictionType === 'COUNTY' && address.county) {
        if (rate.jurisdiction.toUpperCase().includes(address.county.toUpperCase())) return true;
      }

      // Match by city
      if (rate.jurisdictionType === 'CITY' && address.city) {
        if (rate.jurisdiction.toUpperCase().includes(address.city.toUpperCase())) return true;
      }

      return false;
    });
  }

  private async isProductTaxable(
    organizationId: string,
    inventoryItemId?: string,
    productCategory?: string,
  ): Promise<boolean> {
    if (!inventoryItemId && !productCategory) {
      return true; // Default to taxable
    }

    const exemption = await this.prisma.productTaxability.findFirst({
      where: {
        organizationId,
        isExempt: true,
        OR: [
          { inventoryItemId },
          { productCategory },
        ],
      },
    });

    return !exemption;
  }

  // Tax Liabilities
  async recordTaxLiability(
    organizationId: string,
    agencyId: string,
    periodStart: Date,
    periodEnd: Date,
    taxableAmount: number,
    taxCollected: number,
  ) {
    const agency = await this.prisma.taxAgency.findFirst({
      where: { id: agencyId, organizationId },
    });

    if (!agency) {
      throw new NotFoundException('Tax agency not found');
    }

    // Calculate due date based on filing frequency
    const dueDate = this.calculateDueDate(periodEnd, agency.filingFrequency, agency.dueDayOfMonth);

    const existing = await this.prisma.salesTaxLiability.findFirst({
      where: {
        organizationId,
        agencyId,
        periodStart,
        periodEnd,
      },
    });

    if (existing) {
      return this.prisma.salesTaxLiability.update({
        where: { id: existing.id },
        data: {
          taxableSales: { increment: new Prisma.Decimal(taxableAmount) },
          taxCollected: { increment: new Prisma.Decimal(taxCollected) },
          amountDue: { increment: new Prisma.Decimal(taxCollected) },
        },
      });
    }

    return this.prisma.salesTaxLiability.create({
      data: {
        organizationId,
        agencyId,
        periodStart,
        periodEnd,
        taxableSales: new Prisma.Decimal(taxableAmount),
        taxCollected: new Prisma.Decimal(taxCollected),
        amountDue: new Prisma.Decimal(taxCollected),
        dueDate,
        status: 'ACCRUING',
      },
    });
  }

  private calculateDueDate(periodEnd: Date, frequency: string, dueDayOfMonth?: number | null): Date {
    const dueDate = new Date(periodEnd);

    switch (frequency) {
      case 'MONTHLY':
        dueDate.setMonth(dueDate.getMonth() + 1);
        break;
      case 'QUARTERLY':
        dueDate.setMonth(dueDate.getMonth() + 1);
        break;
      case 'ANNUALLY':
        dueDate.setFullYear(dueDate.getFullYear() + 1);
        break;
      case 'SEMIANNUALLY':
        dueDate.setMonth(dueDate.getMonth() + 1);
        break;
    }

    if (dueDayOfMonth) {
      dueDate.setDate(dueDayOfMonth);
    } else {
      dueDate.setDate(15); // Default to 15th
    }

    return dueDate;
  }

  async getTaxLiabilities(
    organizationId: string,
    options?: { agencyId?: string; status?: string; year?: number },
  ) {
    const where: Prisma.SalesTaxLiabilityWhereInput = {
      organizationId,
      ...(options?.agencyId && { agencyId: options.agencyId }),
      ...(options?.status && { status: options.status as any }),
      ...(options?.year && {
        periodStart: {
          gte: new Date(options.year, 0, 1),
          lt: new Date(options.year + 1, 0, 1),
        },
      }),
    };

    return this.prisma.salesTaxLiability.findMany({
      where,
      include: { agency: true },
      orderBy: { dueDate: 'asc' },
    });
  }

  async fileTaxReturn(
    organizationId: string,
    liabilityId: string,
    filingData: {
      filedBy: string;
      filingMethod: string;
      confirmationNumber?: string;
      paymentAmount?: number;
      paymentMethod?: string;
      paymentReference?: string;
    },
  ) {
    const liability = await this.prisma.salesTaxLiability.findFirst({
      where: { id: liabilityId, organizationId },
    });

    if (!liability) {
      throw new NotFoundException('Tax liability not found');
    }

    // Create filing record
    const filing = await this.prisma.salesTaxFiling.create({
      data: {
        liabilityId,
        agencyId: liability.agencyId,
        filedDate: new Date(),
        filedBy: filingData.filedBy,
        filingMethod: filingData.filingMethod,
        confirmationNumber: filingData.confirmationNumber,
        paymentDate: filingData.paymentAmount ? new Date() : null,
        paymentAmount: filingData.paymentAmount ? new Prisma.Decimal(filingData.paymentAmount) : null,
        paymentMethod: filingData.paymentMethod,
        paymentReference: filingData.paymentReference,
      },
    });

    // Update liability status
    await this.prisma.salesTaxLiability.update({
      where: { id: liabilityId },
      data: {
        status: filingData.paymentAmount ? 'PAID' : 'FILED',
        amountPaid: filingData.paymentAmount ? new Prisma.Decimal(filingData.paymentAmount) : undefined,
      },
    });

    return filing;
  }

  // Tax Summary Report
  async getTaxSummary(organizationId: string, startDate: Date, endDate: Date) {
    const liabilities = await this.prisma.salesTaxLiability.findMany({
      where: {
        organizationId,
        periodStart: { gte: startDate },
        periodEnd: { lte: endDate },
      },
      include: { agency: true },
    });

    const summary = {
      period: { startDate, endDate },
      totalTaxableSales: 0,
      totalExemptSales: 0,
      totalTaxCollected: 0,
      totalTaxPaid: 0,
      totalTaxDue: 0,
      byAgency: [] as Array<{
        agencyName: string;
        jurisdiction: string;
        taxableSales: number;
        exemptSales: number;
        taxCollected: number;
        taxPaid: number;
        taxDue: number;
        status: string;
      }>,
    };

    for (const liability of liabilities) {
      const taxableSales = Number(liability.taxableSales);
      const exemptSales = Number(liability.exemptSales);
      const taxCollected = Number(liability.taxCollected);
      const taxPaid = Number(liability.amountPaid);
      const taxDue = Number(liability.amountDue) - taxPaid;

      summary.totalTaxableSales += taxableSales;
      summary.totalExemptSales += exemptSales;
      summary.totalTaxCollected += taxCollected;
      summary.totalTaxPaid += taxPaid;
      summary.totalTaxDue += taxDue;

      summary.byAgency.push({
        agencyName: liability.agency.name,
        jurisdiction: liability.agency.jurisdiction,
        taxableSales,
        exemptSales,
        taxCollected,
        taxPaid,
        taxDue,
        status: liability.status,
      });
    }

    return summary;
  }
}
