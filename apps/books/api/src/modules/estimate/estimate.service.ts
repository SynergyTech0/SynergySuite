import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEstimateDto } from './dto/create-estimate.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class EstimateService {
  private readonly logger = new Logger(EstimateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createEstimate(organizationId: string, dto: CreateEstimateDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });

    if (!customer || customer.organizationId !== organizationId) {
      throw new NotFoundException(`Customer not found`);
    }

    // Generate estimate number
    const estimateCount = await this.prisma.estimate.count({
      where: { organizationId },
    });
    const estimateNumber = `EST-${new Date().getFullYear()}-${String(estimateCount + 1).padStart(5, '0')}`;

    // Calculate totals
    let subtotal = new Decimal(0);
    const lineItems = dto.lineItems.map((item, index) => {
      const amount = new Decimal(item.quantity).times(new Decimal(item.unitPrice));
      subtotal = subtotal.plus(amount);
      return {
        ...item,
        amount: amount.toNumber(),
        lineNumber: index + 1,
      };
    });

    const tax = subtotal.times(new Decimal(0.1)); // 10% tax
    const total = subtotal.plus(tax);

    const estimate = await this.prisma.estimate.create({
      data: {
        id: uuidv4(),
        organizationId,
        customerId: dto.customerId,
        estimateNumber,
        estimateDate: new Date(dto.estimateDate),
        expiryDate: new Date(dto.expiryDate),
        subject: dto.subject || '',
        description: dto.description,
        notes: dto.notes,
        currency: dto.currency || 'USD',
        subtotal: subtotal.toNumber(),
        tax: tax.toNumber(),
        total: total.toNumber(),
        createdBy: 'system',
        lineItems: {
          createMany: {
            data: lineItems,
          },
        },
      },
      include: {
        lineItems: true,
      },
    });

    this.logger.log(`Estimate ${estimateNumber} created for organization ${organizationId}`);
    return estimate;
  }

  async getEstimate(organizationId: string, estimateId: string) {
    const estimate = await this.prisma.estimate.findUnique({
      where: { id: estimateId },
      include: {
        lineItems: true,
        customer: true,
      },
    });

    if (!estimate || estimate.organizationId !== organizationId) {
      throw new NotFoundException(`Estimate not found`);
    }

    return estimate;
  }

  async getEstimates(organizationId: string, filters?: { customerId?: string; status?: string }) {
    return this.prisma.estimate.findMany({
      where: {
        organizationId,
        ...(filters?.customerId && { customerId: filters.customerId }),
        ...(filters?.status && { status: filters.status as any }),
      },
      include: {
        lineItems: true,
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async convertToInvoice(organizationId: string, estimateId: string, invoiceDate?: Date) {
    const estimate = await this.getEstimate(organizationId, estimateId);

    if (estimate.status === 'CONVERTED') {
      throw new BadRequestException('Estimate already converted to invoice');
    }

    // Create invoice
    const invoiceCount = await this.prisma.invoice.count({
      where: { organizationId },
    });
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(invoiceCount + 1).padStart(5, '0')}`;

    const dueDate = new Date(invoiceDate || new Date());
    dueDate.setDate(dueDate.getDate() + 30); // Net 30

    const invoice = await this.prisma.invoice.create({
      data: {
        organizationId,
        customerId: estimate.customerId,
        invoiceNumber,
        invoiceDate: invoiceDate || new Date(),
        dueDate,
        subtotal: estimate.subtotal,
        taxAmount: estimate.tax,
        totalAmount: estimate.total,
        amountDue: estimate.total,
        lineItems: {
          createMany: {
            data: estimate.lineItems.map((item) => ({
              lineNumber: item.lineNumber,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.amount,
              taxable: item.taxable,
            })),
          },
        },
      },
      include: {
        lineItems: true,
      },
    });

    // Update estimate as converted
    await this.prisma.estimate.update({
      where: { id: estimateId },
      data: {
        status: 'CONVERTED',
        convertedToInvoiceId: invoice.id,
        convertedAt: new Date(),
      },
    });

    this.logger.log(`Estimate ${estimate.estimateNumber} converted to invoice ${invoiceNumber}`);
    return invoice;
  }

  async updateEstimateStatus(organizationId: string, estimateId: string, status: string) {
    const estimate = await this.getEstimate(organizationId, estimateId);

    const updated = await this.prisma.estimate.update({
      where: { id: estimateId },
      data: {
        status: status as any,
        ...(status === 'SENT' && { sentAt: new Date() }),
        ...(status === 'VIEWED' && { viewedAt: new Date() }),
      },
      include: { lineItems: true, customer: true },
    });

    return updated;
  }

  async deleteEstimate(organizationId: string, estimateId: string) {
    const estimate = await this.getEstimate(organizationId, estimateId);

    if (estimate.status === 'CONVERTED') {
      throw new BadRequestException('Cannot delete converted estimate');
    }

    await this.prisma.estimate.delete({
      where: { id: estimateId },
    });

    this.logger.log(`Estimate ${estimate.estimateNumber} deleted`);
  }
}
