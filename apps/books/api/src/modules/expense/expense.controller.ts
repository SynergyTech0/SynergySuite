import { Controller, Get, Post, Body, Param, Put, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExpenseService, CreateExpenseDto } from './expense.service';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('organizations/:organizationId/expenses')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post()
  @ApiOperation({ summary: 'Create an expense' })
  async createExpense(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expenseService.createExpense(organizationId, dto, 'user-id');
  }

  @Get(':expenseId')
  @ApiOperation({ summary: 'Get an expense' })
  async getExpense(
    @Param('organizationId') organizationId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expenseService.getExpense(organizationId, expenseId);
  }

  @Get()
  @ApiOperation({ summary: 'List expenses' })
  async listExpenses(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('category') category?: string,
  ) {
    return this.expenseService.listExpenses(organizationId, { status, vendorId, category });
  }

  @Put(':expenseId/approve')
  @ApiOperation({ summary: 'Approve an expense' })
  async approveExpense(
    @Param('organizationId') organizationId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expenseService.approveExpense(organizationId, expenseId, 'user-id');
  }

  @Put(':expenseId/reject')
  @ApiOperation({ summary: 'Reject an expense' })
  async rejectExpense(
    @Param('organizationId') organizationId: string,
    @Param('expenseId') expenseId: string,
    @Body('reason') reason: string,
  ) {
    return this.expenseService.rejectExpense(organizationId, expenseId, 'user-id', reason);
  }
}
