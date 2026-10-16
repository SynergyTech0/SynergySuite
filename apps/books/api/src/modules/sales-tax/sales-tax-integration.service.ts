import { Injectable, Logger } from '@nestjs/common';
import { SalesTaxService } from './sales-tax.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface TaxAddress {
  state?: string;
  city?: string;
  county?: string;
  zipCode?: string;
}

/** Narrow a JSON address column to the fields used for tax jurisdiction lookup. */
function toTaxAddress(value: Prisma.JsonValue | null | undefined): TaxAddress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Prisma.JsonObject;
  const str = (v: Prisma.JsonValue | undefined): string | undefined =>
    typeof v === 'string' ? v : undefined;
  return {
    state: str(obj.state),
    city: str(obj.city),
    county: str(obj.county),
    zipCode: str(obj.zipCode) ?? str(obj.postalCode) ?? str(obj.zip),
  };
}

export interface InvoiceTaxCalculation {
  invoiceId: string;
  customerId: string;
  customerAddress?: {
    state?: string;
    city?: string;
    county?: string;
    zipCode?: string;
  };
  lines: Array<{
    amount: number;
    inventoryItemId?: string;
    productCategory?: string;
  }>;
  transactionDate: Date;
}

@Injectable()
export class SalesTaxIntegrationService {
  private readonly logger = new Logger(SalesTaxIntegrationService.name);

  constructor(
    private readonly salesTaxService: SalesTaxService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Calculate and apply sales tax to an invoice
   */
  async calculateInvoiceTax(organizationId: string, calculation: InvoiceTaxCalculation) {
    try {
      // Get customer address for tax calculation
      const customer = await this.prisma.customer.findUnique({
        where: { id: calculation.customerId },
        select: {
          billingAddress: true,
          shippingAddress: true,
          taxExempt: true,
        },
      });

      if (!customer) {
        this.logger.warn(`Customer ${calculation.customerId} not found for tax calculation`);
        return null;
      }

      // Use shipping address if available, otherwise billing address
      const address = calculation.customerAddress ||
        toTaxAddress(customer.shippingAddress) ||
        toTaxAddress(customer.billingAddress);

      if (!address) {
        this.logger.warn(`No address found for customer ${calculation.customerId}`);
        return null;
      }

      // Calculate tax using sales tax service
      const taxResult = await this.salesTaxService.calculateTax(organizationId, {
        lineItems: calculation.lines,
        shipToAddress: {
          state: address.state,
          city: address.city,
          county: address.county,
          zipCode: address.zipCode,
        },
        customerId: calculation.customerId,
        transactionDate: calculation.transactionDate,
      });

      return taxResult;
    } catch (error) {
      this.logger.error(`Error calculating tax for invoice ${calculation.invoiceId}:`, error);
      throw error;
    }
  }

  /**
   * Record tax liability when invoice is finalized
   */
  async recordInvoiceTaxLiability(
    organizationId: string,
    invoiceId: string,
    taxAmount: number,
    taxableAmount: number,
    invoiceDate: Date,
  ) {
    try {
      // Get the invoice to find applicable tax rates
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: {
            select: {
              shippingAddress: true,
              billingAddress: true,
            },
          },
        },
      });

      if (!invoice) {
        this.logger.warn(`Invoice ${invoiceId} not found for tax liability recording`);
        return;
      }

      // Get applicable tax rates based on invoice location
      const address = toTaxAddress(invoice.customer.shippingAddress) || toTaxAddress(invoice.customer.billingAddress);
      if (!address) {
        this.logger.warn(`No address found for invoice ${invoiceId}`);
        return;
      }

      // Get tax agencies for the jurisdiction
      const taxAgencies = await this.prisma.taxAgency.findMany({
        where: {
          organizationId,
          isActive: true,
          jurisdiction: address.state,
        },
      });

      // Determine the period for the invoice
      const periodStart = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth(), 1);
      const periodEnd = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + 1, 0);

      // Record liability for each agency
      for (const agency of taxAgencies) {
        await this.salesTaxService.recordTaxLiability(
          organizationId,
          agency.id,
          periodStart,
          periodEnd,
          taxableAmount,
          taxAmount,
        );
      }

      this.logger.log(`Recorded tax liability for invoice ${invoiceId}: $${taxAmount}`);
    } catch (error) {
      this.logger.error(`Error recording tax liability for invoice ${invoiceId}:`, error);
      // Don't throw - this is a background operation
    }
  }

  /**
   * Get sales tax rates for a specific location
   */
  async getTaxRatesForLocation(
    organizationId: string,
    location: {
      state?: string;
      city?: string;
      county?: string;
      zipCode?: string;
    },
  ) {
    const rates = await this.prisma.salesTaxRate.findMany({
      where: {
        organizationId,
        isActive: true,
        effectiveDate: { lte: new Date() },
        OR: [
          { endDate: null },
          { endDate: { gte: new Date() } },
        ],
      },
    });

    // Filter rates by location
    return rates.filter((rate) => {
      if (rate.zipCodes.length > 0 && location.zipCode) {
        if (rate.zipCodes.includes(location.zipCode)) return true;
      }

      if (rate.jurisdictionType === 'STATE' && location.state) {
        if (rate.jurisdiction.toUpperCase() === location.state.toUpperCase()) return true;
      }

      if (rate.jurisdictionType === 'COUNTY' && location.county) {
        if (rate.jurisdiction.toUpperCase().includes(location.county.toUpperCase())) return true;
      }

      if (rate.jurisdictionType === 'CITY' && location.city) {
        if (rate.jurisdiction.toUpperCase().includes(location.city.toUpperCase())) return true;
      }

      return false;
    });
  }

  /**
   * Get the effective tax rate for a location
   */
  async getEffectiveTaxRate(
    organizationId: string,
    location: {
      state?: string;
      city?: string;
      county?: string;
      zipCode?: string;
    },
  ): Promise<number> {
    const rates = await this.getTaxRatesForLocation(organizationId, location);
    
    // Sum all non-compound rates
    const totalRate = rates.reduce((sum, rate) => {
      if (!rate.isCompound) {
        return sum + Number(rate.rate);
      }
      return sum;
    }, 0);

    return totalRate;
  }
}
