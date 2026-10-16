import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        id: uuidv4(),
        organizationId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        taxId: dto.taxId,
        billingAddress: dto.billingAddress as any,
        shippingAddress: dto.shippingAddress as any,
        paymentTerms: dto.paymentTerms || 30,
        creditLimit: dto.creditLimit,
        notes: dto.notes,
        balance: 0,
        isActive: true,
      },
    });
  }

  async findAll(
    organizationId: string,
    options: {
      search?: string;
      isActive?: boolean;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const { search, isActive, skip = 0, take = 50 } = options;

    const where: any = { organizationId };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.prisma.customer.count({ where }),
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
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId },
      include: {
        invoices: {
          orderBy: { invoiceDate: 'desc' },
          take: 10,
        },
        _count: {
          select: { invoices: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    return customer;
  }

  async update(organizationId: string, id: string, dto: UpdateCustomerDto) {
    await this.findById(organizationId, id);

    return this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        taxId: dto.taxId,
        billingAddress: dto.billingAddress as any,
        shippingAddress: dto.shippingAddress as any,
        paymentTerms: dto.paymentTerms,
        creditLimit: dto.creditLimit,
        notes: dto.notes,
        isActive: dto.isActive,
      },
    });
  }

  async delete(organizationId: string, id: string) {
    await this.findById(organizationId, id);

    // Check for open invoices
    const openInvoices = await this.prisma.invoice.count({
      where: {
        customerId: id,
        status: { notIn: ['PAID', 'VOID', 'WRITTEN_OFF'] },
      },
    });

    if (openInvoices > 0) {
      // Soft delete
      return this.prisma.customer.update({
        where: { id },
        data: { isActive: false },
      });
    }

    // Hard delete if no open invoices
    return this.prisma.customer.delete({ where: { id } });
  }

  async updateBalance(customerId: string) {
    // Calculate total outstanding balance from invoices
    const invoices = await this.prisma.invoice.findMany({
      where: {
        customerId,
        status: { notIn: ['VOID', 'WRITTEN_OFF'] },
      },
      select: { amountDue: true },
    });

    const totalBalance = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.amountDue.toString()),
      0,
    );

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { balance: totalBalance },
    });

    return totalBalance;
  }

  async getStatement(
    organizationId: string,
    customerId: string,
    options: { startDate?: Date; endDate?: Date } = {},
  ) {
    await this.findById(organizationId, customerId);

    const where: any = { customerId };

    if (options.startDate || options.endDate) {
      where.invoiceDate = {};
      if (options.startDate) where.invoiceDate.gte = options.startDate;
      if (options.endDate) where.invoiceDate.lte = options.endDate;
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: 'asc' },
      include: {
        payments: {
          orderBy: { paymentDate: 'asc' },
        },
      },
    });

    // Build statement entries
    const entries: any[] = [];
    let runningBalance = 0;

    for (const invoice of invoices) {
      // Invoice entry
      runningBalance += parseFloat(invoice.totalAmount.toString());
      entries.push({
        date: invoice.invoiceDate,
        type: 'INVOICE',
        reference: invoice.invoiceNumber,
        description: `Invoice #${invoice.invoiceNumber}`,
        amount: parseFloat(invoice.totalAmount.toString()),
        balance: runningBalance,
      });

      // Payment entries
      for (const payment of invoice.payments) {
        runningBalance -= parseFloat(payment.amount.toString());
        entries.push({
          date: payment.paymentDate,
          type: 'PAYMENT',
          reference: payment.reference,
          description: `Payment - ${payment.paymentMethod || 'Payment'}`,
          amount: -parseFloat(payment.amount.toString()),
          balance: runningBalance,
        });
      }
    }

    return {
      customerId,
      statementDate: new Date(),
      periodStart: options.startDate,
      periodEnd: options.endDate,
      entries,
      endingBalance: runningBalance,
    };
  }
}
