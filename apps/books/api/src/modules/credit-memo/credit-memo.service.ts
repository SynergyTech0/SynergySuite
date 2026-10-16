import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CreditMemoService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, data: {
    customerId: string;
    creditDate: Date;
    reason?: string;
    notes?: string;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      accountId: string;
      taxable?: boolean;
      classId?: string;
      locationId?: string;
    }>;
    createdBy: string;
  }) {
    const lastCredit = await this.prisma.creditMemo.findFirst({
      where: { organizationId },
      orderBy: { creditNumber: 'desc' },
    });

    const creditNumber = lastCredit
      ? `CM-${String(parseInt(lastCredit.creditNumber.split('-')[1] || '0') + 1).padStart(6, '0')}`
      : 'CM-000001';

    const subtotal = data.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxAmount = 0; // Would calculate based on tax rules

    const creditMemo = await this.prisma.creditMemo.create({
      data: {
        organizationId,
        customerId: data.customerId,
        creditNumber,
        creditDate: data.creditDate,
        status: 'DRAFT',
        subtotal: new Prisma.Decimal(subtotal),
        taxAmount: new Prisma.Decimal(taxAmount),
        totalAmount: new Prisma.Decimal(subtotal + taxAmount),
        appliedAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(subtotal + taxAmount),
        reason: data.reason,
        notes: data.notes,
        createdBy: data.createdBy,
        lineItems: {
          create: data.lineItems.map((item, index) => ({
            lineNumber: index + 1,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unitPrice: new Prisma.Decimal(item.unitPrice),
            amount: new Prisma.Decimal(item.quantity * item.unitPrice),
            accountId: item.accountId,
            taxable: item.taxable ?? true,
            classId: item.classId,
            locationId: item.locationId,
          })),
        },
      },
      include: { lineItems: true, customer: { select: { name: true, email: true } } },
    });

    return creditMemo;
  }

  async issue(organizationId: string, creditMemoId: string) {
    const creditMemo = await this.prisma.creditMemo.findFirst({
      where: { id: creditMemoId, organizationId },
    });

    if (!creditMemo) throw new NotFoundException('Credit memo not found');
    if (creditMemo.status !== 'DRAFT') throw new BadRequestException('Credit memo already issued');

    return this.prisma.creditMemo.update({
      where: { id: creditMemoId },
      data: { status: 'ISSUED' },
    });
  }

  async applyToInvoice(
    organizationId: string,
    creditMemoId: string,
    invoiceId: string,
    amount: number,
    appliedBy: string,
  ) {
    const creditMemo = await this.prisma.creditMemo.findFirst({
      where: { id: creditMemoId, organizationId },
    });

    if (!creditMemo) throw new NotFoundException('Credit memo not found');
    if (creditMemo.status === 'DRAFT') throw new BadRequestException('Credit memo not issued');
    if (creditMemo.status === 'APPLIED') throw new BadRequestException('Credit memo fully applied');

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    const remaining = Number(creditMemo.remainingAmount);
    if (amount > remaining) throw new BadRequestException('Amount exceeds remaining credit');

    const invoiceDue = Number(invoice.amountDue);
    const applyAmount = Math.min(amount, invoiceDue);

    // Create application record
    await this.prisma.creditMemoApplication.create({
      data: {
        creditMemoId,
        invoiceId,
        amount: new Prisma.Decimal(applyAmount),
        appliedBy,
      },
    });

    // Update credit memo
    const newApplied = Number(creditMemo.appliedAmount) + applyAmount;
    const newRemaining = Number(creditMemo.totalAmount) - newApplied;

    await this.prisma.creditMemo.update({
      where: { id: creditMemoId },
      data: {
        appliedAmount: new Prisma.Decimal(newApplied),
        remainingAmount: new Prisma.Decimal(newRemaining),
        status: newRemaining <= 0 ? 'APPLIED' : 'PARTIALLY_APPLIED',
      },
    });

    // Update invoice
    const newInvoicePaid = Number(invoice.amountPaid) + applyAmount;
    const newInvoiceDue = Number(invoice.totalAmount) - newInvoicePaid;

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: new Prisma.Decimal(newInvoicePaid),
        amountDue: new Prisma.Decimal(newInvoiceDue),
        status: newInvoiceDue <= 0 ? 'PAID' : 'PARTIAL',
      },
    });

    return { applied: applyAmount, creditMemoRemaining: newRemaining, invoiceDue: newInvoiceDue };
  }

  async list(organizationId: string, options?: { customerId?: string; status?: string }) {
    return this.prisma.creditMemo.findMany({
      where: {
        organizationId,
        ...(options?.customerId && { customerId: options.customerId }),
        ...(options?.status && { status: options.status as any }),
      },
      include: {
        customer: { select: { name: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { creditDate: 'desc' },
    });
  }

  async get(organizationId: string, creditMemoId: string) {
    const creditMemo = await this.prisma.creditMemo.findFirst({
      where: { id: creditMemoId, organizationId },
      include: {
        customer: true,
        lineItems: true,
        applications: { include: { invoice: { select: { invoiceNumber: true } } } },
      },
    });

    if (!creditMemo) throw new NotFoundException('Credit memo not found');
    return creditMemo;
  }

  async void(organizationId: string, creditMemoId: string) {
    const creditMemo = await this.prisma.creditMemo.findFirst({
      where: { id: creditMemoId, organizationId },
    });

    if (!creditMemo) throw new NotFoundException('Credit memo not found');
    if (creditMemo.status === 'APPLIED' || creditMemo.status === 'PARTIALLY_APPLIED') {
      throw new BadRequestException('Cannot void applied credit memo');
    }

    return this.prisma.creditMemo.update({
      where: { id: creditMemoId },
      data: { status: 'VOID' },
    });
  }
}
