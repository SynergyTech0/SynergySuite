import { Public } from '../auth/guards/suite-auth.guard';
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentIntentDto,
  ProcessPaymentDto,
  CreatePaymentMethodDto,
  RefundPaymentDto,
  SetupGatewayDto,
} from './dto/create-payment.dto';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

// Decorator to get organization ID from request
const GetOrganizationId = () => Param('organizationId');
const GetUserId = () => Req();

@ApiTags('Payments')
@Controller('organizations/:organizationId/payments')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Gateway Management
  @Post('gateways')
  @ApiOperation({ summary: 'Setup a payment gateway (Stripe or Square)' })
  async setupGateway(
    @Param('organizationId') organizationId: string,
    @Body() dto: SetupGatewayDto,
  ) {
    return this.paymentsService.setupGateway(organizationId, dto);
  }

  @Get('gateways')
  @ApiOperation({ summary: 'List all payment gateways' })
  async getGateways(@Param('organizationId') organizationId: string) {
    return this.paymentsService.getGateways(organizationId);
  }

  // Payment Processing
  @Post('intents')
  @ApiOperation({ summary: 'Create a payment intent (Stripe)' })
  async createPaymentIntent(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.paymentsService.createPaymentIntent(organizationId, dto);
  }

  @Post('process')
  @ApiOperation({ summary: 'Process a payment directly' })
  async processPayment(
    @Param('organizationId') organizationId: string,
    @Body() dto: ProcessPaymentDto,
  ) {
    return this.paymentsService.processPayment(organizationId, dto);
  }

  @Post('refund')
  @ApiOperation({ summary: 'Refund a payment' })
  async refundPayment(
    @Param('organizationId') organizationId: string,
    @Body() dto: RefundPaymentDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.paymentsService.refundPayment(organizationId, dto, userId);
  }

  // Payment Methods
  @Post('methods')
  @ApiOperation({ summary: 'Create a payment method for a customer' })
  async createPaymentMethod(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreatePaymentMethodDto,
  ) {
    return this.paymentsService.createPaymentMethod(organizationId, dto);
  }

  @Get('methods/:customerId')
  @ApiOperation({ summary: 'Get payment methods for a customer' })
  async getPaymentMethods(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.paymentsService.getPaymentMethods(organizationId, customerId);
  }

  @Delete('methods/:paymentMethodId')
  @ApiOperation({ summary: 'Delete a payment method' })
  async deletePaymentMethod(
    @Param('organizationId') organizationId: string,
    @Param('paymentMethodId') paymentMethodId: string,
  ) {
    return this.paymentsService.deletePaymentMethod(organizationId, paymentMethodId);
  }

  // Transaction History
  @Get('transactions')
  @ApiOperation({ summary: 'List transactions' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'invoiceId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async getTransactions(
    @Param('organizationId') organizationId: string,
    @Query('customerId') customerId?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.paymentsService.getTransactions(organizationId, {
      customerId,
      invoiceId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('transactions/:transactionId')
  @ApiOperation({ summary: 'Get transaction details' })
  async getTransaction(
    @Param('organizationId') organizationId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.paymentsService.getTransaction(organizationId, transactionId);
  }
}

// Webhook Controller (separate, no auth)
@ApiTags('Payment Webhooks')
@Public()
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('stripe/:gatewayId')
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async stripeWebhook(
    @Param('gatewayId') gatewayId: string,
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const payload = req.rawBody!;
    return this.paymentsService.handleStripeWebhook(gatewayId, payload, signature);
  }

  @Post('square/:gatewayId')
  @ApiOperation({ summary: 'Square webhook endpoint' })
  async squareWebhook(
    @Param('gatewayId') gatewayId: string,
    @Headers('x-square-signature') signature: string,
    @Body() body: any,
  ) {
    return this.paymentsService.handleSquareWebhook(
      gatewayId,
      JSON.stringify(body),
      signature,
    );
  }
}
