import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class VendorCreditService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, data: {
    vendorId: string;
    creditDate: Date;
    vendorCreditNumber?: string;
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
    const lastCredit = await this.prisma.vendorCredit.findFirst({
      where: { organizationId },
      orderBy: { creditNumber: 'desc' },
    });

    const creditNumber = lastCredit
      ? `VC-${String(parseInt(lastCredit.creditNumber.split('-')[1] || '0') + 1).padStart(6, '0')}`
      : 'VC-000001';

    const subtotal = data.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    return this.prisma.vendorCredit.create({
      data: {
        organizationId,
        vendorId: data.vendorId,
        creditNumber,
        creditDate: data.creditDate,
        vendorCreditNumber: data.vendorCreditNumber,
        status: 'DRAFT',
        subtotal: new Prisma.Decimal(subtotal),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(subtotal),
        appliedAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(subtotal),
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
      include: { lineItems: true, vendor: { select: { name: true } } },
    });
  }

  async receive(organizationId: string, vendorCreditId: string) {
    const vendorCredit = await this.prisma.vendorCredit.findFirst({
      where: { id: vendorCreditId, organizationId },
    });

    if (!vendorCredit) throw new NotFoundException('Vendor credit not found');
    if (vendorCredit.status !== 'DRAFT') throw new BadRequestException('Vendor credit already received');

    return this.prisma.vendorCredit.update({
      where: { id: vendorCreditId },
      data: { status: 'RECEIVED' },
    });
  }

  async applyToBill(
    organizationId: string,
    vendorCreditId: string,
    billId: string,
    amount: number,
    appliedBy: string,
  ) {
    const vendorCredit = await this.prisma.vendorCredit.findFirst({
      where: { id: vendorCreditId, organizationId },
    });

    if (!vendorCredit) throw new NotFoundException('Vendor credit not found');
    if (vendorCredit.status === 'DRAFT') throw new BadRequestException('Vendor credit not received');
    if (vendorCredit.status === 'APPLIED') throw new BadRequestException('Vendor credit fully applied');

    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, organizationId },
    });

    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.vendorId !== vendorCredit.vendorId) throw new BadRequestException('Vendor credit and bill vendors must match');

    const remaining = Number(vendorCredit.remainingAmount);
    if (amount > remaining) throw new BadRequestException('Amount exceeds remaining credit');

    const billDue = Number(bill.amountDue);
    const applyAmount = Math.min(amount, billDue);

    await this.prisma.vendorCreditApplication.create({
      data: {
        vendorCreditId,
        billId,
        amount: new Prisma.Decimal(applyAmount),
        appliedBy,
      },
    });

    const newApplied = Number(vendorCredit.appliedAmount) + applyAmount;
    const newRemaining = Number(vendorCredit.totalAmount) - newApplied;

    await this.prisma.vendorCredit.update({
      where: { id: vendorCreditId },
      data: {
        appliedAmount: new Prisma.Decimal(newApplied),
        remainingAmount: new Prisma.Decimal(newRemaining),
        status: newRemaining <= 0 ? 'APPLIED' : 'PARTIALLY_APPLIED',
      },
    });

    const newBillPaid = Number(bill.amountPaid) + applyAmount;
    const newBillDue = Number(bill.totalAmount) - newBillPaid;

    await this.prisma.bill.update({
      where: { id: billId },
      data: {
        amountPaid: new Prisma.Decimal(newBillPaid),
        amountDue: new Prisma.Decimal(newBillDue),
        status: newBillDue <= 0 ? 'PAID' : 'PARTIAL',
      },
    });

    return { applied: applyAmount, vendorCreditRemaining: newRemaining, billDue: newBillDue };
  }

  async list(organizationId: string, options?: { vendorId?: string; status?: string }) {
    return this.prisma.vendorCredit.findMany({
      where: {
        organizationId,
        ...(options?.vendorId && { vendorId: options.vendorId }),
        ...(options?.status && { status: options.status as any }),
      },
      include: {
        vendor: { select: { name: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { creditDate: 'desc' },
    });
  }

  async get(organizationId: string, vendorCreditId: string) {
    const vendorCredit = await this.prisma.vendorCredit.findFirst({
      where: { id: vendorCreditId, organizationId },
      include: {
        vendor: true,
        lineItems: true,
        applications: { include: { bill: { select: { billNumber: true } } } },
      },
    });

    if (!vendorCredit) throw new NotFoundException('Vendor credit not found');
    return vendorCredit;
  }
}
