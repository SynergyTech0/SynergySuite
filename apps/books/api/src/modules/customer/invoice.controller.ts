import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { StripeCollectService } from './stripe-collect.service';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  RecordPaymentDto,
  InvoiceResponseDto,
  InvoiceStatus,
} from './dto/invoice.dto';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('organizations/:organizationId/invoices')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly stripeCollectService: StripeCollectService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new invoice' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 201,
    description: 'Invoice created successfully',
    type: InvoiceResponseDto,
  })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoiceService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all invoices' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: InvoiceStatus })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: InvoiceStatus,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.invoiceService.findAll(organizationId, {
      customerId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      search,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Get overdue invoices' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async getOverdue(@Param('organizationId') organizationId: string) {
    return this.invoiceService.getOverdueInvoices(organizationId);
  }

  @Get('aging')
  @ApiOperation({ summary: 'Get AR aging report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async getAgingReport(@Param('organizationId') organizationId: string) {
    return this.invoiceService.getAgingReport(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @ApiResponse({
    status: 200,
    description: 'Invoice details',
    type: InvoiceResponseDto,
  })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.findById(organizationId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update invoice (draft only)' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @ApiResponse({
    status: 200,
    description: 'Invoice updated successfully',
    type: InvoiceResponseDto,
  })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.update(organizationId, id, dto);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send invoice to customer' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async send(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.send(organizationId, id);
  }

  @Post(':id/stripe-collect')
  @ApiOperation({ summary: 'Collect online: mirror to a hosted Stripe invoice' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async stripeCollect(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() body: { send?: boolean },
  ) {
    return this.stripeCollectService.sendToStripe(organizationId, id, { send: body?.send });
  }

  @Post(':id/stripe-refresh')
  @ApiOperation({ summary: 'Refresh Stripe payment status; auto-record payment when paid' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async stripeRefresh(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.stripeCollectService.refreshStatus(organizationId, id);
  }

  @Post(':id/payment')
  @ApiOperation({ summary: 'Record payment for invoice' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async recordPayment(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.invoiceService.recordPayment(organizationId, id, dto);
  }

  @Post(':id/void')
  @ApiOperation({ summary: 'Void invoice' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async void(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.invoiceService.void(organizationId, id, reason);
  }
}
