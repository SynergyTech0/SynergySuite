import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CreditMemoService } from './credit-memo.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Credit Memos')
@Controller('organizations/:organizationId/credit-memos')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class CreditMemoController {
  constructor(private readonly creditMemoService: CreditMemoService) {}

  @Post()
  @ApiOperation({ summary: 'Create credit memo' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() data: any,
    @Req() req: any,
  ) {
    return this.creditMemoService.create(organizationId, { ...data, createdBy: req.user?.id || 'system' });
  }

  @Get()
  @ApiOperation({ summary: 'List credit memos' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @Param('organizationId') organizationId: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    return this.creditMemoService.list(organizationId, { customerId, status });
  }

  @Get(':creditMemoId')
  @ApiOperation({ summary: 'Get credit memo details' })
  async get(
    @Param('organizationId') organizationId: string,
    @Param('creditMemoId') creditMemoId: string,
  ) {
    return this.creditMemoService.get(organizationId, creditMemoId);
  }

  @Post(':creditMemoId/issue')
  @ApiOperation({ summary: 'Issue credit memo' })
  async issue(
    @Param('organizationId') organizationId: string,
    @Param('creditMemoId') creditMemoId: string,
  ) {
    return this.creditMemoService.issue(organizationId, creditMemoId);
  }

  @Post(':creditMemoId/apply')
  @ApiOperation({ summary: 'Apply credit memo to invoice' })
  async apply(
    @Param('organizationId') organizationId: string,
    @Param('creditMemoId') creditMemoId: string,
    @Body() body: { invoiceId: string; amount: number },
    @Req() req: any,
  ) {
    return this.creditMemoService.applyToInvoice(
      organizationId,
      creditMemoId,
      body.invoiceId,
      body.amount,
      req.user?.id || 'system',
    );
  }

  @Post(':creditMemoId/void')
  @ApiOperation({ summary: 'Void credit memo' })
  async void(
    @Param('organizationId') organizationId: string,
    @Param('creditMemoId') creditMemoId: string,
  ) {
    return this.creditMemoService.void(organizationId, creditMemoId);
  }
}
