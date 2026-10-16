import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class VendorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateVendorDto) {
    return this.prisma.vendor.create({
      data: {
        id: uuidv4(),
        organizationId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        taxId: dto.taxId,
        address: dto.address as any,
        paymentTerms: dto.paymentTerms || 30,
        defaultExpenseAccountId: dto.defaultExpenseAccountId,
        requires1099: dto.is1099 || false,
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
      is1099?: boolean;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const { search, isActive, is1099, skip = 0, take = 50 } = options;

    const where: any = { organizationId };
    if (isActive !== undefined) where.isActive = isActive;
    if (is1099 !== undefined) where.requires1099 = is1099;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.vendor.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.vendor.count({ where }),
    ]);

    return {
      items: items.map((vendor) => ({ ...vendor, is1099: vendor.requires1099 })),
      total,
      page: Math.floor(skip / take) + 1,
      pageSize: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async findById(organizationId: string, id: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, organizationId },
      include: {
        bills: { orderBy: { billDate: 'desc' }, take: 10 },
        _count: { select: { bills: true } },
      },
    });

    if (!vendor) {
      throw new NotFoundException(`Vendor ${id} not found`);
    }

    return { ...vendor, is1099: vendor.requires1099 };
  }

  async update(organizationId: string, id: string, dto: UpdateVendorDto) {
    await this.findById(organizationId, id);

    return this.prisma.vendor.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        taxId: dto.taxId,
        address: dto.address as any,
        paymentTerms: dto.paymentTerms,
        defaultExpenseAccountId: dto.defaultExpenseAccountId,
        requires1099: dto.is1099,
        notes: dto.notes,
        isActive: dto.isActive,
      },
    });
  }

  async delete(organizationId: string, id: string) {
    await this.findById(organizationId, id);

    const openBills = await this.prisma.bill.count({
      where: { vendorId: id, status: { notIn: ['PAID', 'VOID'] } },
    });

    if (openBills > 0) {
      return this.prisma.vendor.update({
        where: { id },
        data: { isActive: false },
      });
    }

    return this.prisma.vendor.delete({ where: { id } });
  }

  async updateBalance(vendorId: string) {
    const bills = await this.prisma.bill.findMany({
      where: { vendorId, status: { notIn: ['VOID'] } },
      select: { balance: true },
    });

    const totalBalance = bills.reduce(
      (sum, bill) => sum + parseFloat(bill.balance.toString()),
      0,
    );

    await this.prisma.vendor.update({
      where: { id: vendorId },
      data: { balance: totalBalance },
    });

    return totalBalance;
  }

  async get1099Report(organizationId: string, year: number) {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    const vendors = await this.prisma.vendor.findMany({
      where: { organizationId, requires1099: true },
      include: {
        bills: {
          where: {
            status: { in: ['PAID', 'PARTIAL'] },
            billDate: { gte: startDate, lte: endDate },
          },
        },
      },
    });

    return vendors.map((vendor) => ({
      vendorId: vendor.id,
      vendorName: vendor.name,
      taxId: vendor.taxId,
      address: vendor.address,
      totalPaid: vendor.bills.reduce(
        (sum, bill) => sum + parseFloat(bill.amountPaid.toString()),
        0,
      ),
    }));
  }
}
