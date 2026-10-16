import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { v4 as uuidv4 } from 'uuid';

export class CreateBudgetDto {
  budgetName: string;
  fiscalYear: number;
  period: string; // MONTHLY, QUARTERLY, ANNUAL
  startDate: Date;
  endDate: Date;
  lineItems: BudgetLineItemDto[];
}

export class BudgetLineItemDto {
  accountId: string;
  budgetAmount: number;
}

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createBudget(organizationId: string, dto: CreateBudgetDto) {
    // Verify accounts exist
    for (const item of dto.lineItems) {
      const account = await this.prisma.account.findUnique({
        where: { id: item.accountId },
      });

      if (!account || account.organizationId !== organizationId) {
        throw new NotFoundException(`Account ${item.accountId} not found`);
      }
    }

    const budget = await this.prisma.budget.create({
      data: {
        id: uuidv4(),
        organizationId,
        budgetName: dto.budgetName,
        fiscalYear: dto.fiscalYear,
        period: dto.period as any,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: 'DRAFT',
        lineItems: {
          createMany: {
            data: dto.lineItems.map((item) => ({
              accountId: item.accountId,
              budgetAmount: item.budgetAmount,
            })),
          },
        },
      },
      include: { lineItems: { include: { account: true } } },
    });

    this.logger.log(`Budget ${dto.budgetName} created for fiscal year ${dto.fiscalYear}`);
    return budget;
  }

  async getBudget(organizationId: string, budgetId: string) {
    const budget = await this.prisma.budget.findUnique({
      where: { id: budgetId },
      include: { lineItems: { include: { account: true } } },
    });

    if (!budget || budget.organizationId !== organizationId) {
      throw new NotFoundException('Budget not found');
    }

    return budget;
  }

  async listBudgets(organizationId: string, filters?: { fiscalYear?: number; status?: string }) {
    return this.prisma.budget.findMany({
      where: {
        organizationId,
        ...(filters?.fiscalYear && { fiscalYear: filters.fiscalYear }),
        ...(filters?.status && { status: filters.status }),
      },
      include: { lineItems: { include: { account: true } } },
      orderBy: { fiscalYear: 'desc' },
    });
  }

  async approveBudget(organizationId: string, budgetId: string) {
    const budget = await this.getBudget(organizationId, budgetId);

    if (budget.status !== 'DRAFT') {
      throw new BadRequestException('Only draft budgets can be approved');
    }

    return this.prisma.budget.update({
      where: { id: budgetId },
      data: { status: 'APPROVED' },
      include: { lineItems: { include: { account: true } } },
    });
  }

  async activateBudget(organizationId: string, budgetId: string) {
    const budget = await this.getBudget(organizationId, budgetId);

    if (budget.status !== 'APPROVED') {
      throw new BadRequestException('Only approved budgets can be activated');
    }

    return this.prisma.budget.update({
      where: { id: budgetId },
      data: { status: 'ACTIVE' },
      include: { lineItems: { include: { account: true } } },
    });
  }

  async closeBudget(organizationId: string, budgetId: string) {
    const budget = await this.getBudget(organizationId, budgetId);

    return this.prisma.budget.update({
      where: { id: budgetId },
      data: { status: 'CLOSED' },
    });
  }

  async updateBudgetLineItem(organizationId: string, budgetId: string, accountId: string, budgetAmount: number, forecastAmount?: number) {
    const budget = await this.getBudget(organizationId, budgetId);

    return this.prisma.budgetLineItem.update({
      where: {
        budgetId_accountId: {
          budgetId,
          accountId,
        },
      },
      data: {
        budgetAmount,
        ...(forecastAmount !== undefined && { forecastAmount }),
      },
      include: { account: true },
    });
  }

  async getBudgetVariance(organizationId: string, budgetId: string) {
    const budget = await this.getBudget(organizationId, budgetId);

    const variance = budget.lineItems.map((item) => {
      const budgetAmount = new Decimal(item.budgetAmount);
      const actualAmount = new Decimal(item.actualAmount);
      const forecastAmount = new Decimal(item.forecastAmount);

      const actualVariance = actualAmount.minus(budgetAmount);
      const actualPercent = budgetAmount.equals(0) ? 0 : actualVariance.dividedBy(budgetAmount).times(100).toNumber();

      const forecastVariance = forecastAmount.minus(budgetAmount);
      const forecastPercent = budgetAmount.equals(0) ? 0 : forecastVariance.dividedBy(budgetAmount).times(100).toNumber();

      return {
        accountId: item.accountId,
        accountName: item.account.name,
        budgetAmount: item.budgetAmount,
        actualAmount: item.actualAmount,
        forecastAmount: item.forecastAmount,
        actualVariance: actualVariance.toNumber(),
        actualVariancePercent: actualPercent,
        forecastVariance: forecastVariance.toNumber(),
        forecastVariancePercent: forecastPercent,
      };
    });

    return {
      budgetId,
      budgetName: budget.budgetName,
      fiscalYear: budget.fiscalYear,
      period: budget.period,
      status: budget.status,
      lineItems: variance,
    };
  }

  async updateActualAmounts(organizationId: string, budgetId: string, accountAmounts: { accountId: string; actualAmount: number }[]) {
    const budget = await this.getBudget(organizationId, budgetId);

    const updates = await Promise.all(
      accountAmounts.map((item) =>
        this.prisma.budgetLineItem.update({
          where: {
            budgetId_accountId: {
              budgetId,
              accountId: item.accountId,
            },
          },
          data: {
            actualAmount: item.actualAmount,
          },
        }),
      ),
    );

    this.logger.log(`Actual amounts updated for budget ${budget.budgetName}`);
    return updates;
  }

  async deleteBudget(organizationId: string, budgetId: string) {
    const budget = await this.getBudget(organizationId, budgetId);

    if (budget.status !== 'DRAFT') {
      throw new BadRequestException('Can only delete draft budgets');
    }

    await this.prisma.budget.delete({
      where: { id: budgetId },
    });

    this.logger.log(`Budget ${budget.budgetName} deleted`);
  }
}
