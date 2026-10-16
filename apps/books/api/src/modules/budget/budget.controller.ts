import { Controller, Get, Post, Body, Param, Put, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BudgetService, CreateBudgetDto } from './budget.service';

@ApiTags('budgets')
@ApiBearerAuth()
@Controller('organizations/:organizationId/budgets')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Post()
  @ApiOperation({ summary: 'Create a budget' })
  async createBudget(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgetService.createBudget(organizationId, dto);
  }

  @Get(':budgetId')
  @ApiOperation({ summary: 'Get a budget' })
  async getBudget(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.budgetService.getBudget(organizationId, budgetId);
  }

  @Get()
  @ApiOperation({ summary: 'List budgets' })
  async listBudgets(
    @Param('organizationId') organizationId: string,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('status') status?: string,
  ) {
    return this.budgetService.listBudgets(organizationId, {
      fiscalYear: fiscalYear ? parseInt(fiscalYear) : undefined,
      status,
    });
  }

  @Post(':budgetId/approve')
  @ApiOperation({ summary: 'Approve a budget' })
  async approveBudget(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.budgetService.approveBudget(organizationId, budgetId);
  }

  @Post(':budgetId/activate')
  @ApiOperation({ summary: 'Activate a budget' })
  async activateBudget(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.budgetService.activateBudget(organizationId, budgetId);
  }

  @Post(':budgetId/close')
  @ApiOperation({ summary: 'Close a budget' })
  async closeBudget(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.budgetService.closeBudget(organizationId, budgetId);
  }

  @Put(':budgetId/line-item')
  @ApiOperation({ summary: 'Update budget line item' })
  async updateLineItem(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Body() body: { accountId: string; budgetAmount: number; forecastAmount?: number },
  ) {
    return this.budgetService.updateBudgetLineItem(
      organizationId,
      budgetId,
      body.accountId,
      body.budgetAmount,
      body.forecastAmount,
    );
  }

  @Get(':budgetId/variance')
  @ApiOperation({ summary: 'Get budget variance' })
  async getVariance(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.budgetService.getBudgetVariance(organizationId, budgetId);
  }

  @Put(':budgetId/actual-amounts')
  @ApiOperation({ summary: 'Update actual amounts' })
  async updateActualAmounts(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Body() body: { accountAmounts: { accountId: string; actualAmount: number }[] },
  ) {
    return this.budgetService.updateActualAmounts(organizationId, budgetId, body.accountAmounts);
  }

  @Delete(':budgetId')
  @ApiOperation({ summary: 'Delete a budget' })
  async deleteBudget(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.budgetService.deleteBudget(organizationId, budgetId);
  }
}
