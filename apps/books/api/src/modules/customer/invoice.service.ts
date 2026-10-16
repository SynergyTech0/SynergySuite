import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalService } from '../journal/journal.service';
import { CustomerService } from './customer.service';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  RecordPaymentDto,
  InvoiceStatus as InvoiceStatusDto,
} from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { addDays } from 'date-fns';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalService: JournalService,
    private readonly customerService: CustomerService,
  ) {}

  async create(organizationId: string, dto: CreateInvoiceDto) {
    // Verify customer
    const customer = await this.customerService.findById(
      organizationId,
      dto.customerId,
    );

    // Generate invoice number
    const invoiceNumber = await this.generateInvoiceNumber(organizationId);

    // Calculate totals
    const lineCalculations = this.calculateLineAmounts(dto.lines);
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : addDays(new Date(dto.invoiceDate), customer.paymentTerms || 30);

    // Create invoice
    const invoice = await this.prisma.$transaction(async (tx) => {
      const invoiceId = uuidv4();

      // Create invoice header
      const invoice = await tx.invoice.create({
        data: {
          id: invoiceId,
          organizationId,
          customerId: dto.customerId,
          invoiceNumber,
          invoiceDate: new Date(dto.invoiceDate),
          dueDate,
          status: InvoiceStatus.DRAFT,
          subtotal: lineCalculations.subtotal,
          taxAmount: lineCalculations.taxAmount,
          discountAmount: lineCalculations.discountAmount,
          totalAmount: lineCalculations.total,
          amountDue: lineCalculations.total,
          amountPaid: 0,
          poNumber: dto.poNumber,
          terms: dto.terms,
          notes: dto.notes,
          memo: dto.memo,
        },
      });

      // Create invoice lines
      for (let i = 0; i < dto.lines.length; i++) {
        const line = dto.lines[i];
        const lineAmount = this.calculateSingleLineAmount(line);

        await tx.invoiceLineItem.create({
          data: {
            id: uuidv4(),
            invoiceId,
            lineNumber: i + 1,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent || 0,
            taxRate: line.taxRate || 0,
            amount: lineAmount.lineTotal,
            taxAmount: lineAmount.taxAmount,
            accountId: line.accountId,
          },
        });
      }

      return invoice;
    });

    return this.findById(organizationId, invoice.id);
  }

  async findAll(
    organizationId: string,
    options: {
      customerId?: string;
      status?: InvoiceStatusDto | InvoiceStatus;
      startDate?: Date;
      endDate?: Date;
      search?: string;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const { customerId, status, startDate, endDate, search, skip = 0, take = 50 } = options;

    const where: any = { organizationId };

    if (customerId) where.customerId = customerId;
    // The DTO still uses VOIDED; the database enum value is VOID
    if (status) where.status = status === InvoiceStatusDto.VOIDED ? InvoiceStatus.VOID : status;
    if (startDate) where.invoiceDate = { ...where.invoiceDate, gte: startDate };
    if (endDate) where.invoiceDate = { ...where.invoiceDate, lte: endDate };
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, email: true } },
        },
        orderBy: { invoiceDate: 'desc' },
        skip,
        take,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items,
      total,
      page: Math.floor(skip / take) + 1,
      pageSize: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async findById(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        lineItems: {
          orderBy: { lineNumber: 'asc' },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    // Invoice only stores journalId (no relation); resolve the linked journal separately
    const journal = invoice.journalId
      ? await this.prisma.journal.findFirst({
          where: { id: invoice.journalId, organizationId },
          select: { id: true, journalNumber: true },
        })
      : null;

    return {
      ...invoice,
      journalEntry: journal
        ? { id: journal.id, entryNumber: journal.journalNumber }
        : null,
    };
  }

  async update(organizationId: string, id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findById(organizationId, id);

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Can only update draft invoices');
    }

    return this.prisma.$transaction(async (tx) => {
      // Update lines if provided
      if (dto.lines) {
        // Delete existing lines
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });

        const lineCalculations = this.calculateLineAmounts(dto.lines);

        // Create new lines
        for (let i = 0; i < dto.lines.length; i++) {
          const line = dto.lines[i];
          const lineAmount = this.calculateSingleLineAmount(line);

          await tx.invoiceLineItem.create({
            data: {
              id: uuidv4(),
              invoiceId: id,
              lineNumber: i + 1,
              productId: line.productId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPercent: line.discountPercent || 0,
              taxRate: line.taxRate || 0,
              amount: lineAmount.lineTotal,
              taxAmount: lineAmount.taxAmount,
              accountId: line.accountId,
            },
          });
        }

        // Update totals
        await tx.invoice.update({
          where: { id },
          data: {
            subtotal: lineCalculations.subtotal,
            taxAmount: lineCalculations.taxAmount,
            discountAmount: lineCalculations.discountAmount,
            totalAmount: lineCalculations.total,
            amountDue: lineCalculations.total,
          },
        });
      }

      // Update other fields
      await tx.invoice.update({
        where: { id },
        data: {
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          poNumber: dto.poNumber,
          terms: dto.terms,
          notes: dto.notes,
          memo: dto.memo,
        },
      });

      return this.findById(organizationId, id);
    });
  }

  async send(organizationId: string, id: string) {
    const invoice = await this.findById(organizationId, id);

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Can only send draft invoices');
    }

    // Create journal entry for the invoice
    await this.createInvoiceJournalEntry(organizationId, invoice);

    // Update status
    await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.SENT,
        sentAt: new Date(),
      },
    });

    // Update customer balance
    await this.customerService.updateBalance(invoice.customerId);

    return this.findById(organizationId, id);
  }

  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
  ) {
    const invoice = await this.findById(organizationId, invoiceId);

    if (invoice.status === InvoiceStatus.VOID || invoice.status === InvoiceStatus.WRITTEN_OFF) {
      throw new BadRequestException('Cannot record payment on voided invoice');
    }

    const paymentAmount = new Decimal(dto.amount);
    const currentBalance = new Decimal(invoice.amountDue.toString());

    if (paymentAmount.greaterThan(currentBalance)) {
      throw new BadRequestException(
        `Payment amount ${dto.amount} exceeds invoice balance ${currentBalance}`,
      );
    }

    // Create payment record
    const payment = await this.prisma.$transaction(async (tx) => {
      const paymentId = uuidv4();

      // Create payment
      const payment = await tx.invoicePayment.create({
        data: {
          id: paymentId,
          invoiceId,
          paymentDate: new Date(dto.paymentDate),
          amount: paymentAmount.toNumber(),
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          notes: dto.notes,
        },
      });

      // Update invoice
      const newBalance = currentBalance.minus(paymentAmount);
      const newAmountPaid = new Decimal(invoice.amountPaid.toString()).plus(paymentAmount);
      const newStatus = newBalance.isZero()
        ? InvoiceStatus.PAID
        : InvoiceStatus.PARTIAL;

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          amountDue: newBalance.toNumber(),
          amountPaid: newAmountPaid.toNumber(),
          status: newStatus,
          paidAt: newBalance.isZero() ? new Date() : undefined,
        },
      });

      return payment;
    });

    // Create payment journal entry
    await this.createPaymentJournalEntry(organizationId, invoice, dto);

    // Update customer balance
    await this.customerService.updateBalance(invoice.customerId);

    return this.findById(organizationId, invoiceId);
  }

  async void(organizationId: string, id: string, reason: string) {
    const invoice = await this.findById(organizationId, id);

    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException('Invoice is already voided');
    }

    if (Number(invoice.amountPaid) > 0) {
      throw new BadRequestException(
        'Cannot void invoice with payments. Refund payments first.',
      );
    }

    // Void related journal entry if exists
    if (invoice.journalId) {
      await this.journalService.void(organizationId, invoice.journalId, reason);
    }

    await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.VOID,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });

    // Update customer balance
    await this.customerService.updateBalance(invoice.customerId);

    return this.findById(organizationId, id);
  }

  async getOverdueInvoices(organizationId: string) {
    const today = new Date();

    return this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.VIEWED, InvoiceStatus.PARTIAL] },
        dueDate: { lt: today },
        amountDue: { gt: 0 },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async getAgingReport(organizationId: string) {
    const today = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: { notIn: [InvoiceStatus.VOID, InvoiceStatus.WRITTEN_OFF, InvoiceStatus.PAID] },
        amountDue: { gt: 0 },
      },
      include: {
        customer: { select: { id: true, name: true } },
      },
    });

    const aging = {
      current: [] as any[],
      days1to30: [] as any[],
      days31to60: [] as any[],
      days61to90: [] as any[],
      over90: [] as any[],
    };

    for (const invoice of invoices) {
      const dueDate = new Date(invoice.dueDate || invoice.invoiceDate);
      const daysPastDue = Math.floor(
        (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      const entry = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customer.id,
        customerName: invoice.customer.name,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        balance: parseFloat(invoice.amountDue.toString()),
        daysPastDue: Math.max(0, daysPastDue),
      };

      if (daysPastDue <= 0) {
        aging.current.push(entry);
      } else if (daysPastDue <= 30) {
        aging.days1to30.push(entry);
      } else if (daysPastDue <= 60) {
        aging.days31to60.push(entry);
      } else if (daysPastDue <= 90) {
        aging.days61to90.push(entry);
      } else {
        aging.over90.push(entry);
      }
    }

    return {
      asOfDate: today,
      summary: {
        current: aging.current.reduce((sum, i) => sum + i.balance, 0),
        days1to30: aging.days1to30.reduce((sum, i) => sum + i.balance, 0),
        days31to60: aging.days31to60.reduce((sum, i) => sum + i.balance, 0),
        days61to90: aging.days61to90.reduce((sum, i) => sum + i.balance, 0),
        over90: aging.over90.reduce((sum, i) => sum + i.balance, 0),
        total: invoices.reduce((sum, i) => sum + parseFloat(i.amountDue.toString()), 0),
      },
      detail: aging,
    };
  }

  private async generateInvoiceNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const lastInvoice = await this.prisma.invoice.findFirst({
      where: {
        organizationId,
        invoiceNumber: { startsWith: `INV-${year}-` },
      },
      orderBy: { invoiceNumber: 'desc' },
    });

    let sequence = 1;
    if (lastInvoice) {
      const parts = lastInvoice.invoiceNumber.split('-');
      sequence = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `INV-${year}-${sequence.toString().padStart(5, '0')}`;
  }

  private calculateLineAmounts(lines: any[]) {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);
    let discountAmount = new Decimal(0);

    for (const line of lines) {
      const lineCalc = this.calculateSingleLineAmount(line);
      subtotal = subtotal.plus(lineCalc.subtotal);
      taxAmount = taxAmount.plus(lineCalc.taxAmount);
      discountAmount = discountAmount.plus(lineCalc.discountAmount);
    }

    return {
      subtotal: subtotal.toNumber(),
      taxAmount: taxAmount.toNumber(),
      discountAmount: discountAmount.toNumber(),
      total: subtotal.minus(discountAmount).plus(taxAmount).toNumber(),
    };
  }

  private calculateSingleLineAmount(line: any) {
    const quantity = new Decimal(line.quantity);
    const unitPrice = new Decimal(line.unitPrice);
    const subtotal = quantity.times(unitPrice);

    const discountPercent = new Decimal(line.discountPercent || 0);
    const discountAmount = subtotal.times(discountPercent.dividedBy(100));

    const afterDiscount = subtotal.minus(discountAmount);

    const taxRate = new Decimal(line.taxRate || 0);
    const taxAmount = afterDiscount.times(taxRate.dividedBy(100));

    return {
      subtotal: subtotal.toNumber(),
      discountAmount: discountAmount.toNumber(),
      taxAmount: taxAmount.toNumber(),
      lineTotal: afterDiscount.plus(taxAmount).toNumber(),
    };
  }

  private async createInvoiceJournalEntry(organizationId: string, invoice: any) {
    // Debit: Accounts Receivable
    // Credit: Revenue accounts (from lines)
    // Credit: Sales Tax Payable (if applicable)

    const arAccount = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '1100' },
    });

    const revenueAccount = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '4000' },
    });

    const taxAccount = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '2300' },
    });

    if (!arAccount || !revenueAccount) {
      return; // Skip journal entry if accounts not found
    }

    const lines: any[] = [
      {
        accountId: arAccount.id,
        debit: parseFloat(invoice.totalAmount.toString()),
        description: `Invoice #${invoice.invoiceNumber}`,
        referenceType: 'INVOICE',
        referenceId: invoice.id,
      },
      {
        accountId: revenueAccount.id,
        credit: parseFloat(invoice.subtotal.toString()) - parseFloat((invoice.discountAmount ?? 0).toString()),
        description: `Invoice #${invoice.invoiceNumber} - Revenue`,
      },
    ];

    if (Number(invoice.taxAmount) > 0 && taxAccount) {
      lines.push({
        accountId: taxAccount.id,
        credit: parseFloat(invoice.taxAmount.toString()),
        description: `Invoice #${invoice.invoiceNumber} - Sales Tax`,
      });
    }

    const journal = await this.journalService.create(organizationId, {
      date: invoice.invoiceDate.toISOString(),
      type: 'GENERAL' as any,
      source: 'INVOICE' as any,
      reference: invoice.invoiceNumber,
      description: `Invoice #${invoice.invoiceNumber} to ${invoice.customer?.name}`,
      lines,
    });

    // Link journal to invoice
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { journalId: journal.id },
    });

    // Post the journal entry
    await this.journalService.post(organizationId, journal.id);
  }

  private async createPaymentJournalEntry(
    organizationId: string,
    invoice: any,
    payment: RecordPaymentDto,
  ) {
    // Debit: Cash/Bank
    // Credit: Accounts Receivable

    const cashAccount = await this.prisma.account.findFirst({
      where: { organizationId, id: payment.depositAccountId || undefined },
    }) || await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '1010' },
    });

    const arAccount = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '1100' },
    });

    if (!cashAccount || !arAccount) {
      return;
    }

    const journal = await this.journalService.create(organizationId, {
      date: payment.paymentDate,
      type: 'GENERAL' as any,
      source: 'RECEIPT' as any,
      reference: payment.reference || `PMT-${invoice.invoiceNumber}`,
      description: `Payment received for Invoice #${invoice.invoiceNumber}`,
      lines: [
        {
          accountId: cashAccount.id,
          debit: payment.amount,
          description: `Payment - Invoice #${invoice.invoiceNumber}`,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
        },
        {
          accountId: arAccount.id,
          credit: payment.amount,
          description: `Payment - Invoice #${invoice.invoiceNumber}`,
        },
      ],
    });

    await this.journalService.post(organizationId, journal.id);
  }
}
