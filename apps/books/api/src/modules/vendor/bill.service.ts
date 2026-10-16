import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalService } from '../journal/journal.service';
import { VendorService } from './vendor.service';
import { CreateBillDto, UpdateBillDto, RecordBillPaymentDto, BillStatus as BillStatusDto } from './dto/bill.dto';
import { BillStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { addDays } from 'date-fns';

@Injectable()
export class BillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalService: JournalService,
    private readonly vendorService: VendorService,
  ) {}

  async create(organizationId: string, dto: CreateBillDto) {
    const vendor = await this.vendorService.findById(organizationId, dto.vendorId);
    const billNumber = await this.generateBillNumber(organizationId);
    const lineCalculations = this.calculateLineAmounts(dto.lines);
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : addDays(new Date(dto.billDate), vendor.paymentTerms || 30);

    const bill = await this.prisma.$transaction(async (tx) => {
      const billId = uuidv4();

      const bill = await tx.bill.create({
        data: {
          id: billId,
          organizationId,
          vendorId: dto.vendorId,
          billNumber,
          billDate: new Date(dto.billDate),
          dueDate,
          vendorInvoiceNumber: dto.vendorInvoiceNumber,
          status: BillStatus.DRAFT,
          subtotal: lineCalculations.subtotal,
          taxAmount: lineCalculations.taxAmount,
          totalAmount: lineCalculations.total,
          amountDue: lineCalculations.total,
          balance: lineCalculations.total,
          amountPaid: 0,
          notes: dto.notes,
        },
      });

      for (let i = 0; i < dto.lines.length; i++) {
        const line = dto.lines[i];
        const lineAmount = this.calculateSingleLineAmount(line);

        await tx.billLineItem.create({
          data: {
            id: uuidv4(),
            billId,
            lineNumber: i + 1,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate || 0,
            amount: lineAmount.lineTotal,
            taxAmount: lineAmount.taxAmount,
            accountId: line.accountId || vendor.defaultExpenseAccountId,
          },
        });
      }

      return bill;
    });

    return this.findById(organizationId, bill.id);
  }

  async findAll(
    organizationId: string,
    options: {
      vendorId?: string;
      status?: BillStatusDto;
      startDate?: Date;
      endDate?: Date;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const { vendorId, status, startDate, endDate, skip = 0, take = 50 } = options;
    const where: any = { organizationId };

    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = this.toPrismaBillStatus(status);
    if (startDate) where.billDate = { ...where.billDate, gte: startDate };
    if (endDate) where.billDate = { ...where.billDate, lte: endDate };

    const [items, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        include: { vendor: { select: { id: true, name: true } } },
        orderBy: { billDate: 'desc' },
        skip,
        take,
      }),
      this.prisma.bill.count({ where }),
    ]);

    return { items, total, page: Math.floor(skip / take) + 1, pageSize: take, totalPages: Math.ceil(total / take) };
  }

  async findById(organizationId: string, id: string) {
    const bill = await this.prisma.bill.findFirst({
      where: { id, organizationId },
      include: {
        vendor: true,
        lineItems: { orderBy: { lineNumber: 'asc' } },
        payments: { orderBy: { paymentDate: 'desc' } },
        journalEntry: { select: { id: true, journalNumber: true } },
      },
    });

    if (!bill) throw new NotFoundException(`Bill ${id} not found`);

    // Preserve the legacy response shape (total, lines, journalEntry.entryNumber)
    const { lineItems, journalEntry, ...rest } = bill;
    return {
      ...rest,
      total: bill.totalAmount,
      lines: lineItems,
      journalEntry: journalEntry
        ? { id: journalEntry.id, entryNumber: journalEntry.journalNumber }
        : null,
    };
  }

  private toPrismaBillStatus(status: BillStatusDto): BillStatus {
    switch (status) {
      case BillStatusDto.PENDING:
        return BillStatus.PENDING_APPROVAL;
      case BillStatusDto.VOIDED:
        return BillStatus.VOID;
      default:
        return status as BillStatus;
    }
  }

  async approve(organizationId: string, id: string) {
    const bill = await this.findById(organizationId, id);
    if (bill.status !== BillStatus.DRAFT && bill.status !== BillStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Can only approve draft or pending bills');
    }

    await this.createBillJournalEntry(organizationId, bill);

    await this.prisma.bill.update({
      where: { id },
      data: { status: BillStatus.APPROVED, approvedAt: new Date() },
    });

    await this.vendorService.updateBalance(bill.vendorId);
    return this.findById(organizationId, id);
  }

  async recordPayment(organizationId: string, billId: string, dto: RecordBillPaymentDto) {
    const bill = await this.findById(organizationId, billId);

    if (bill.status === BillStatus.VOID) {
      throw new BadRequestException('Cannot record payment on voided bill');
    }

    const paymentAmount = new Decimal(dto.amount);
    const currentBalance = new Decimal(bill.balance.toString());

    if (paymentAmount.greaterThan(currentBalance)) {
      throw new BadRequestException(`Payment amount exceeds bill balance`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.billPayment.create({
        data: {
          id: uuidv4(),
          billId,
          paymentDate: new Date(dto.paymentDate),
          amount: paymentAmount.toNumber(),
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          notes: dto.notes,
        },
      });

      const newBalance = currentBalance.minus(paymentAmount);
      const newAmountPaid = new Decimal(bill.amountPaid.toString()).plus(paymentAmount);
      const newStatus = newBalance.isZero() ? BillStatus.PAID : BillStatus.PARTIAL;

      await tx.bill.update({
        where: { id: billId },
        data: {
          balance: newBalance.toNumber(),
          amountDue: newBalance.toNumber(),
          amountPaid: newAmountPaid.toNumber(),
          status: newStatus,
          paidAt: newBalance.isZero() ? new Date() : undefined,
        },
      });
    });

    await this.createPaymentJournalEntry(organizationId, bill, dto);
    await this.vendorService.updateBalance(bill.vendorId);

    return this.findById(organizationId, billId);
  }

  async getAPAgingReport(organizationId: string) {
    const today = new Date();
    const bills = await this.prisma.bill.findMany({
      where: {
        organizationId,
        status: { notIn: [BillStatus.VOID, BillStatus.PAID] },
        balance: { gt: 0 },
      },
      include: { vendor: { select: { id: true, name: true } } },
    });

    const aging = {
      current: [] as any[],
      days1to30: [] as any[],
      days31to60: [] as any[],
      days61to90: [] as any[],
      over90: [] as any[],
    };

    for (const bill of bills) {
      const dueDate = new Date(bill.dueDate || bill.billDate);
      const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      const entry = {
        billId: bill.id,
        billNumber: bill.billNumber,
        vendorId: bill.vendor.id,
        vendorName: bill.vendor.name,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        balance: parseFloat(bill.balance.toString()),
        daysPastDue: Math.max(0, daysPastDue),
      };

      if (daysPastDue <= 0) aging.current.push(entry);
      else if (daysPastDue <= 30) aging.days1to30.push(entry);
      else if (daysPastDue <= 60) aging.days31to60.push(entry);
      else if (daysPastDue <= 90) aging.days61to90.push(entry);
      else aging.over90.push(entry);
    }

    return {
      asOfDate: today,
      summary: {
        current: aging.current.reduce((sum, i) => sum + i.balance, 0),
        days1to30: aging.days1to30.reduce((sum, i) => sum + i.balance, 0),
        days31to60: aging.days31to60.reduce((sum, i) => sum + i.balance, 0),
        days61to90: aging.days61to90.reduce((sum, i) => sum + i.balance, 0),
        over90: aging.over90.reduce((sum, i) => sum + i.balance, 0),
        total: bills.reduce((sum, i) => sum + parseFloat(i.balance.toString()), 0),
      },
      detail: aging,
    };
  }

  private async generateBillNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const lastBill = await this.prisma.bill.findFirst({
      where: { organizationId, billNumber: { startsWith: `BILL-${year}-` } },
      orderBy: { billNumber: 'desc' },
    });

    let sequence = 1;
    if (lastBill) {
      const parts = lastBill.billNumber.split('-');
      sequence = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `BILL-${year}-${sequence.toString().padStart(5, '0')}`;
  }

  private calculateLineAmounts(lines: any[]) {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);

    for (const line of lines) {
      const lineCalc = this.calculateSingleLineAmount(line);
      subtotal = subtotal.plus(lineCalc.subtotal);
      taxAmount = taxAmount.plus(lineCalc.taxAmount);
    }

    return {
      subtotal: subtotal.toNumber(),
      taxAmount: taxAmount.toNumber(),
      total: subtotal.plus(taxAmount).toNumber(),
    };
  }

  private calculateSingleLineAmount(line: any) {
    const quantity = new Decimal(line.quantity);
    const unitPrice = new Decimal(line.unitPrice);
    const subtotal = quantity.times(unitPrice);
    const taxRate = new Decimal(line.taxRate || 0);
    const taxAmount = subtotal.times(taxRate.dividedBy(100));

    return {
      subtotal: subtotal.toNumber(),
      taxAmount: taxAmount.toNumber(),
      lineTotal: subtotal.plus(taxAmount).toNumber(),
    };
  }

  private async createBillJournalEntry(organizationId: string, bill: any) {
    const apAccount = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '2000' },
    });

    if (!apAccount) return;

    const lines: any[] = [];

    // Debit expense accounts
    for (const line of bill.lines) {
      if (line.accountId) {
        lines.push({
          accountId: line.accountId,
          debit: parseFloat(line.amount.toString()),
          description: line.description,
        });
      }
    }

    // Credit AP
    lines.push({
      accountId: apAccount.id,
      credit: parseFloat(bill.total.toString()),
      description: `Bill #${bill.billNumber}`,
      referenceType: 'BILL',
      referenceId: bill.id,
    });

    const journal = await this.journalService.create(organizationId, {
      date: bill.billDate.toISOString(),
      type: 'GENERAL' as any,
      source: 'BILL' as any,
      reference: bill.billNumber,
      description: `Bill #${bill.billNumber} from ${bill.vendor?.name}`,
      lines,
    });

    await this.prisma.bill.update({
      where: { id: bill.id },
      data: { journalId: journal.id },
    });

    await this.journalService.post(organizationId, journal.id);
  }

  private async createPaymentJournalEntry(
    organizationId: string,
    bill: any,
    payment: RecordBillPaymentDto,
  ) {
    const cashAccount = await this.prisma.account.findFirst({
      where: { organizationId, id: payment.payFromAccountId || undefined },
    }) || await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '1010' },
    });

    const apAccount = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '2000' },
    });

    if (!cashAccount || !apAccount) return;

    const journal = await this.journalService.create(organizationId, {
      date: payment.paymentDate,
      type: 'GENERAL' as any,
      source: 'PAYMENT' as any,
      reference: payment.reference || `PMT-${bill.billNumber}`,
      description: `Payment for Bill #${bill.billNumber}`,
      lines: [
        {
          accountId: apAccount.id,
          debit: payment.amount,
          description: `Payment - Bill #${bill.billNumber}`,
        },
        {
          accountId: cashAccount.id,
          credit: payment.amount,
          description: `Payment - Bill #${bill.billNumber}`,
          referenceType: 'BILL',
          referenceId: bill.id,
        },
      ],
    });

    await this.journalService.post(organizationId, journal.id);
  }
}
