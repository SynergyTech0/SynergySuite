import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

export class CreateExpenseDto {
  category: string;
  description: string;
  amount: number;
  currency?: string;
  vendorId?: string;
  accountId?: string;
  expenseDate?: Date;
  notes?: string;
}

@Injectable()
export class ExpenseService {
  private readonly logger = new Logger(ExpenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createExpense(organizationId: string, dto: CreateExpenseDto, userId: string) {
    const vendor = dto.vendorId
      ? await this.prisma.vendor.findUnique({ where: { id: dto.vendorId } })
      : null;

    if (dto.vendorId && !vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const expenseCount = await this.prisma.expense.count({ where: { organizationId } });
    const expenseNumber = `EXP-${new Date().getFullYear()}-${String(expenseCount + 1).padStart(5, '0')}`;

    const expense = await this.prisma.expense.create({
      data: {
        id: uuidv4(),
        organizationId,
        expenseNumber,
        category: dto.category as any,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency || 'USD',
        vendorId: dto.vendorId,
        accountId: dto.accountId,
        expenseDate: dto.expenseDate || new Date(),
        notes: dto.notes,
        createdBy: userId,
        status: 'DRAFT',
      },
    });

    this.logger.log(`Expense ${expenseNumber} created`);
    return expense;
  }

  async getExpense(organizationId: string, expenseId: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: { vendor: true, account: true, documents: true, auditTrail: true },
    });

    if (!expense || expense.organizationId !== organizationId) {
      throw new NotFoundException('Expense not found');
    }

    return expense;
  }

  async listExpenses(
    organizationId: string,
    filters?: { status?: string; vendorId?: string; category?: string },
  ) {
    return this.prisma.expense.findMany({
      where: {
        organizationId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.vendorId && { vendorId: filters.vendorId }),
        ...(filters?.category && { category: filters.category as any }),
      },
      include: { vendor: true, account: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveExpense(organizationId: string, expenseId: string, userId: string) {
    const expense = await this.getExpense(organizationId, expenseId);

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date(),
      },
      include: { vendor: true, account: true },
    });

    // Create audit trail
    await this.prisma.auditTrailEntry.create({
      data: {
        organizationId,
        actionType: 'APPROVE',
        entityType: 'Expense',
        entityId: expenseId,
        userId,
        changes: { status: { from: expense.status, to: 'APPROVED' } },
      },
    });

    return updated;
  }

  async rejectExpense(organizationId: string, expenseId: string, userId: string, reason: string) {
    const expense = await this.getExpense(organizationId, expenseId);

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'REJECTED',
        approvedBy: userId,
        approvedAt: new Date(),
        notes: `${expense.notes || ''}\nRejected: ${reason}`,
      },
    });

    await this.prisma.auditTrailEntry.create({
      data: {
        organizationId,
        actionType: 'REJECT',
        entityType: 'Expense',
        entityId: expenseId,
        userId,
        notes: reason,
      },
    });

    return updated;
  }
}
