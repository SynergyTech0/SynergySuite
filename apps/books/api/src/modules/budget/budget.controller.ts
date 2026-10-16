import { BadRequestException, Controller, Get, Post, Body, Param, Put, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BudgetService } from './budget.service';
import { BudgetFromActualsDto, BudgetLineItemDto, CreateBudgetDto, SaveForecastDto, UpdateBudgetDto } from './budget.dto';
import { FORECAST_METHODS, ForecastMethod } from './budget-math';

@ApiTags('budgets')
@ApiBearerAuth()
@Controller('organizations/:organizationId/budgets')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Post()
  @ApiOperation({ summary: 'Create a budget' })
  async createBudget(@Param('organizationId') organizationId: string, @Body() dto: CreateBudgetDto) {
    return this.budgetService.createBudget(organizationId, dto);
  }

  @Post('from-actuals')
  @ApiOperation({ summary: "Create a budget from an earlier year's actuals" })
  async createFromActuals(@Param('organizationId') organizationId: string, @Body() dto: BudgetFromActualsDto) {
    return this.budgetService.createFromActuals(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List budgets' })
  async listBudgets(
    @Param('organizationId') organizationId: string,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('status') status?: string,
  ) {
    return this.budgetService.listBudgets(organizationId, {
      fiscalYear: fiscalYear ? parseInt(fiscalYear, 10) : undefined,
      status,
    });
  }

  @Get(':budgetId')
  @ApiOperation({ summary: 'Get a budget with its plan by period' })
  async getBudget(@Param('organizationId') organizationId: string, @Param('budgetId') budgetId: string) {
    return this.budgetService.getBudget(organizationId, budgetId);
  }

  @Put(':budgetId')
  @ApiOperation({ summary: 'Rename a budget, change its notes, or replace its lines' })
  async updateBudget(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgetService.updateBudget(organizationId, budgetId, dto);
  }

  @Put(':budgetId/line-item')
  @ApiOperation({ summary: 'Set or add one budget line' })
  async updateLineItem(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Body() body: BudgetLineItemDto,
  ) {
    return this.budgetService.updateBudgetLineItem(organizationId, budgetId, body);
  }

  @Delete(':budgetId/line-item/:accountId')
  @ApiOperation({ summary: 'Remove a budget line' })
  async removeLineItem(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Param('accountId') accountId: string,
  ) {
    return this.budgetService.removeLineItem(organizationId, budgetId, accountId);
  }

  @Post(':budgetId/approve')
  @ApiOperation({ summary: 'Approve a budget' })
  async approveBudget(@Param('organizationId') organizationId: string, @Param('budgetId') budgetId: string) {
    return this.budgetService.approveBudget(organizationId, budgetId);
  }

  @Post(':budgetId/activate')
  @ApiOperation({ summary: 'Activate a budget' })
  async activateBudget(@Param('organizationId') organizationId: string, @Param('budgetId') budgetId: string) {
    return this.budgetService.activateBudget(organizationId, budgetId);
  }

  @Post(':budgetId/close')
  @ApiOperation({ summary: 'Close a budget' })
  async closeBudget(@Param('organizationId') organizationId: string, @Param('budgetId') budgetId: string) {
    return this.budgetService.closeBudget(organizationId, budgetId);
  }

  @Post(':budgetId/reopen')
  @ApiOperation({ summary: 'Send a budget back to draft' })
  async reopenBudget(@Param('organizationId') organizationId: string, @Param('budgetId') budgetId: string) {
    return this.budgetService.reopenBudget(organizationId, budgetId);
  }

  @Get(':budgetId/variance')
  @ApiOperation({ summary: 'Budget vs actual from the ledger, by period' })
  async getVariance(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.budgetService.getBudgetVariance(organizationId, budgetId, asOf);
  }

  @Get(':budgetId/forecast')
  @ApiOperation({ summary: 'Rolling forecast: actuals so far, the rest projected' })
  async getForecast(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Query('method') method = 'RUN_RATE',
    @Query('asOf') asOf?: string,
  ) {
    if (!FORECAST_METHODS.includes(method as ForecastMethod)) {
      throw new BadRequestException(`method must be one of ${FORECAST_METHODS.join(', ')}`);
    }
    return this.budgetService.getForecast(organizationId, budgetId, method as ForecastMethod, asOf);
  }

  @Post(':budgetId/forecast')
  @ApiOperation({ summary: 'Save a forecast onto the budget' })
  async saveForecast(
    @Param('organizationId') organizationId: string,
    @Param('budgetId') budgetId: string,
    @Body() dto: SaveForecastDto,
  ) {
    return this.budgetService.saveForecast(organizationId, budgetId, dto.method, dto.asOf);
  }

  @Delete(':budgetId')
  @ApiOperation({ summary: 'Delete a budget' })
  async deleteBudget(@Param('organizationId') organizationId: string, @Param('budgetId') budgetId: string) {
    return this.budgetService.deleteBudget(organizationId, budgetId);
  }
}
