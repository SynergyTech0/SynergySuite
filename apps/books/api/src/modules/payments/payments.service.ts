import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeProvider } from './providers/stripe.provider';
import { SquareProvider } from './providers/square.provider';
import {
  CreatePaymentIntentDto,
  ProcessPaymentDto,
  CreatePaymentMethodDto,
  RefundPaymentDto,
  SetupGatewayDto,
} from './dto/create-payment.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeProvider: StripeProvider,
    private readonly squareProvider: SquareProvider,
  ) {}

  // Gateway Management
  async setupGateway(organizationId: string, dto: SetupGatewayDto) {
    // Encrypt secret key before storing (in production, use proper encryption)
    const encryptedSecret = Buffer.from(dto.secretKey).toString('base64');

    const gateway = await this.prisma.paymentGateway.create({
      data: {
        organizationId,
        provider: dto.provider,
        name: dto.name,
        publicKey: dto.publicKey,
        secretKeyEncrypted: encryptedSecret,
        webhookSecret: dto.webhookSecret,
        merchantId: dto.merchantId,
        locationId: dto.locationId,
        isDefault: dto.isDefault,
        status: 'ACTIVE',
      },
    });

    return { id: gateway.id, provider: gateway.provider, name: gateway.name };
  }

  async getGateways(organizationId: string) {
    return this.prisma.paymentGateway.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        name: true,
        isDefault: true,
        status: true,
        publicKey: true,
        merchantId: true,
        locationId: true,
        lastSyncAt: true,
        createdAt: true,
      },
    });
  }

  async getDefaultGateway(organizationId: string) {
    const gateway = await this.prisma.paymentGateway.findFirst({
      where: { organizationId, isDefault: true, status: 'ACTIVE' },
    });

    if (!gateway) {
      // Fallback to any active gateway
      return this.prisma.paymentGateway.findFirst({
        where: { organizationId, status: 'ACTIVE' },
      });
    }

    return gateway;
  }

  private decryptSecretKey(encrypted: string): string {
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }

  // Payment Processing
  async createPaymentIntent(organizationId: string, dto: CreatePaymentIntentDto) {
    const gateway = await this.getDefaultGateway(organizationId);
    if (!gateway) {
      throw new NotFoundException('No active payment gateway configured');
    }

    if (gateway.provider === 'STRIPE') {
      const client = this.stripeProvider.getClient(
        gateway.id,
        this.decryptSecretKey(gateway.secretKeyEncrypted!),
      );

      const intent = await this.stripeProvider.createPaymentIntent(client, {
        amount: dto.amount,
        currency: dto.currency || 'USD',
        description: dto.description,
        metadata: {
          organizationId,
          customerId: dto.customerId,
          invoiceId: dto.invoiceId || '',
          ...dto.metadata,
        },
      });

      // Create transaction record
      const transaction = await this.prisma.paymentTransaction.create({
        data: {
          organizationId,
          gatewayId: gateway.id,
          customerId: dto.customerId,
          invoiceId: dto.invoiceId,
          amount: new Prisma.Decimal(dto.amount / 100), // Convert cents to dollars
          currency: dto.currency || 'USD',
          status: 'PENDING',
          providerTransactionId: intent.id,
          description: dto.description,
        },
      });

      return {
        transactionId: transaction.id,
        clientSecret: intent.clientSecret,
        paymentIntentId: intent.id,
        provider: 'STRIPE',
      };
    } else {
      throw new BadRequestException('Square requires direct payment, not payment intents');
    }
  }

  async processPayment(organizationId: string, dto: ProcessPaymentDto) {
    const gateway = await this.prisma.paymentGateway.findFirst({
      where: { id: dto.gatewayId, organizationId, status: 'ACTIVE' },
    });

    if (!gateway) {
      throw new NotFoundException('Payment gateway not found');
    }

    const secretKey = this.decryptSecretKey(gateway.secretKeyEncrypted!);

    // Create transaction record first
    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        organizationId,
        gatewayId: gateway.id,
        customerId: dto.customerId,
        invoiceId: dto.invoiceId,
        paymentMethodId: dto.paymentMethodId,
        amount: new Prisma.Decimal(dto.amount / 100),
        currency: dto.currency || 'USD',
        status: 'PROCESSING',
        description: dto.description,
        statementDescriptor: dto.statementDescriptor,
        metadata: dto.metadata,
      },
    });

    try {
      if (gateway.provider === 'STRIPE') {
        const client = this.stripeProvider.getClient(gateway.id, secretKey);

        const intent = await this.stripeProvider.createPaymentIntent(client, {
          amount: dto.amount,
          currency: dto.currency || 'USD',
          paymentMethodId: dto.paymentMethodId,
          description: dto.description,
          statementDescriptor: dto.statementDescriptor,
          metadata: {
            transactionId: transaction.id,
            organizationId,
            ...dto.metadata,
          },
        });

        // Update transaction with provider info
        await this.prisma.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            providerTransactionId: intent.id,
            status: intent.status === 'succeeded' ? 'COMPLETED' : 'PROCESSING',
            processedAt: intent.status === 'succeeded' ? new Date() : null,
          },
        });

        return {
          transactionId: transaction.id,
          providerTransactionId: intent.id,
          status: intent.status,
          clientSecret: intent.clientSecret,
        };
      } else if (gateway.provider === 'SQUARE') {
        const client = this.squareProvider.getClient(gateway.id, secretKey);

        if (!dto.paymentMethodId) {
          throw new BadRequestException('Payment method required for Square payments');
        }

        const result = await this.squareProvider.createPayment(client, {
          locationId: gateway.locationId!,
          sourceId: dto.paymentMethodId,
          amount: dto.amount,
          currency: dto.currency || 'USD',
          note: dto.description,
          referenceId: transaction.id,
        });

        // Update transaction
        await this.prisma.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            providerTransactionId: result.id,
            status: result.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING',
            providerFee: new Prisma.Decimal(result.fee / 100),
            netAmount: new Prisma.Decimal(result.netAmount / 100),
            receiptUrl: result.receiptUrl,
            failureCode: result.failureCode,
            failureMessage: result.failureMessage,
            processedAt: result.status === 'COMPLETED' ? new Date() : null,
          },
        });

        // If successful and linked to invoice, update invoice
        if (result.status === 'COMPLETED' && dto.invoiceId) {
          await this.updateInvoicePayment(dto.invoiceId, dto.amount / 100);
        }

        return {
          transactionId: transaction.id,
          providerTransactionId: result.id,
          status: result.status,
          receiptUrl: result.receiptUrl,
        };
      }
    } catch (error) {
      // Update transaction as failed
      await this.prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'FAILED',
          failureCode: (error as Error & { code?: string }).code || 'UNKNOWN',
          failureMessage: (error as Error).message,
        },
      });
      throw error;
    }

    throw new BadRequestException('Unknown payment provider');
  }

  async refundPayment(organizationId: string, dto: RefundPaymentDto, userId: string) {
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { id: dto.transactionId, organizationId },
      include: { gateway: true },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status !== 'COMPLETED') {
      throw new BadRequestException('Can only refund completed transactions');
    }

    const refundAmount = dto.amount || Number(transaction.amount) * 100;
    const secretKey = this.decryptSecretKey(transaction.gateway.secretKeyEncrypted!);

    // Create refund record
    const refund = await this.prisma.paymentRefund.create({
      data: {
        transactionId: transaction.id,
        amount: new Prisma.Decimal(refundAmount / 100),
        reason: dto.reason,
        status: 'PROCESSING',
        createdBy: userId,
      },
    });

    try {
      if (transaction.gateway.provider === 'STRIPE') {
        const client = this.stripeProvider.getClient(
          transaction.gateway.id,
          secretKey,
        );

        const result = await this.stripeProvider.createRefund(client, {
          paymentIntentId: transaction.providerTransactionId!,
          amount: refundAmount,
          reason: dto.reason as any,
        });

        await this.prisma.paymentRefund.update({
          where: { id: refund.id },
          data: {
            providerRefundId: result.id,
            status: result.status === 'succeeded' ? 'COMPLETED' : 'PROCESSING',
            processedAt: result.status === 'succeeded' ? new Date() : null,
            failureCode: result.failureReason,
          },
        });

        // Update transaction status if full refund
        if (refundAmount >= Number(transaction.amount) * 100) {
          await this.prisma.paymentTransaction.update({
            where: { id: transaction.id },
            data: { status: 'REFUNDED' },
          });
        } else {
          await this.prisma.paymentTransaction.update({
            where: { id: transaction.id },
            data: { status: 'PARTIALLY_REFUNDED' },
          });
        }

        return { refundId: refund.id, status: result.status };
      } else if (transaction.gateway.provider === 'SQUARE') {
        const client = this.squareProvider.getClient(
          transaction.gateway.id,
          secretKey,
        );

        const result = await this.squareProvider.createRefund(client, {
          paymentId: transaction.providerTransactionId!,
          amount: refundAmount,
          currency: transaction.currency,
          reason: dto.reason,
        });

        await this.prisma.paymentRefund.update({
          where: { id: refund.id },
          data: {
            providerRefundId: result.id,
            status: result.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING',
            processedAt: result.status === 'COMPLETED' ? new Date() : null,
            failureMessage: result.failureReason,
          },
        });

        return { refundId: refund.id, status: result.status };
      }
    } catch (error) {
      await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          failureCode: (error as Error & { code?: string }).code,
          failureMessage: (error as Error).message,
        },
      });
      throw error;
    }

    throw new BadRequestException('Unknown payment provider');
  }

  // Payment Methods
  async createPaymentMethod(organizationId: string, dto: CreatePaymentMethodDto) {
    const gateway = await this.getDefaultGateway(organizationId);
    if (!gateway) {
      throw new NotFoundException('No active payment gateway configured');
    }

    const secretKey = this.decryptSecretKey(gateway.secretKeyEncrypted!);

    const paymentMethod = await this.prisma.paymentMethod.create({
      data: {
        organizationId,
        customerId: dto.customerId,
        type: dto.type,
        isDefault: dto.isDefault,
        stripePaymentMethodId: dto.stripePaymentMethodId,
        squareCardId: dto.squareCardId,
        billingAddress: dto.billingAddress as any,
      },
    });

    // If Stripe and we have a payment method ID, retrieve card details
    if (gateway.provider === 'STRIPE' && dto.stripePaymentMethodId) {
      const client = this.stripeProvider.getClient(gateway.id, secretKey);
      const pm = await this.stripeProvider.getPaymentMethod(client, dto.stripePaymentMethodId);

      if (pm.card) {
        await this.prisma.paymentMethod.update({
          where: { id: paymentMethod.id },
          data: {
            cardBrand: pm.card.brand,
            cardLast4: pm.card.last4,
            cardExpMonth: pm.card.exp_month,
            cardExpYear: pm.card.exp_year,
            isVerified: true,
          },
        });
      }
    }

    return paymentMethod;
  }

  async getPaymentMethods(organizationId: string, customerId: string) {
    return this.prisma.paymentMethod.findMany({
      where: { organizationId, customerId },
      select: {
        id: true,
        type: true,
        isDefault: true,
        cardBrand: true,
        cardLast4: true,
        cardExpMonth: true,
        cardExpYear: true,
        bankName: true,
        accountLast4: true,
        isVerified: true,
        createdAt: true,
      },
    });
  }

  async deletePaymentMethod(organizationId: string, paymentMethodId: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, organizationId },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found');
    }

    await this.prisma.paymentMethod.delete({ where: { id: paymentMethodId } });
    return { success: true };
  }

  // Transaction History
  async getTransactions(
    organizationId: string,
    options: {
      customerId?: string;
      invoiceId?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.PaymentTransactionWhereInput = {
      organizationId,
      ...(options.customerId && { customerId: options.customerId }),
      ...(options.invoiceId && { invoiceId: options.invoiceId }),
      ...(options.status && { status: options.status as any }),
      ...(options.startDate || options.endDate
        ? {
            createdAt: {
              ...(options.startDate && { gte: options.startDate }),
              ...(options.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        include: {
          gateway: { select: { provider: true, name: true } },
          paymentMethod: {
            select: { type: true, cardBrand: true, cardLast4: true },
          },
          refunds: true,
        },
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
      }),
      this.prisma.paymentTransaction.count({ where }),
    ]);

    return { transactions, total };
  }

  async getTransaction(organizationId: string, transactionId: string) {
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { id: transactionId, organizationId },
      include: {
        gateway: { select: { provider: true, name: true } },
        paymentMethod: true,
        customer: { select: { id: true, name: true, email: true } },
        invoice: { select: { id: true, invoiceNumber: true, totalAmount: true } },
        refunds: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  // Webhook Handlers
  async handleStripeWebhook(
    gatewayId: string,
    payload: Buffer,
    signature: string,
  ) {
    const gateway = await this.prisma.paymentGateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway || !gateway.webhookSecret) {
      throw new BadRequestException('Gateway not found or webhook secret not configured');
    }

    const event = await this.stripeProvider.constructWebhookEvent(
      payload,
      signature,
      gateway.webhookSecret,
    );

    this.logger.log(`Processing Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as any;
        await this.handlePaymentSuccess(paymentIntent.id, 'STRIPE');
        break;
      }
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as any;
        await this.handlePaymentFailure(
          paymentIntent.id,
          paymentIntent.last_payment_error?.code,
          paymentIntent.last_payment_error?.message,
        );
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as any;
        this.logger.log(`Charge refunded: ${charge.id}`);
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as any;
        await this.handleDispute(dispute.payment_intent, dispute.id);
        break;
      }
    }

    return { received: true };
  }

  async handleSquareWebhook(
    gatewayId: string,
    payload: string,
    signature: string,
  ) {
    const gateway = await this.prisma.paymentGateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway || !gateway.webhookSecret) {
      throw new BadRequestException('Gateway not found or webhook secret not configured');
    }

    // Verify signature in production
    const event = JSON.parse(payload);

    this.logger.log(`Processing Square webhook: ${event.type}`);

    switch (event.type) {
      case 'payment.completed': {
        const payment = event.data.object.payment;
        await this.handlePaymentSuccess(payment.id, 'SQUARE');
        break;
      }
      case 'payment.failed': {
        const payment = event.data.object.payment;
        await this.handlePaymentFailure(
          payment.id,
          payment.card_details?.errors?.[0]?.code,
          payment.card_details?.errors?.[0]?.detail,
        );
        break;
      }
      case 'refund.completed': {
        this.logger.log(`Square refund completed: ${event.data.id}`);
        break;
      }
    }

    return { received: true };
  }

  private async handlePaymentSuccess(providerTransactionId: string, provider: string) {
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { providerTransactionId },
    });

    if (transaction) {
      await this.prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
        },
      });

      // Update invoice if linked
      if (transaction.invoiceId) {
        await this.updateInvoicePayment(
          transaction.invoiceId,
          Number(transaction.amount),
        );
      }
    }
  }

  private async handlePaymentFailure(
    providerTransactionId: string,
    code?: string,
    message?: string,
  ) {
    await this.prisma.paymentTransaction.updateMany({
      where: { providerTransactionId },
      data: {
        status: 'FAILED',
        failureCode: code,
        failureMessage: message,
      },
    });
  }

  private async handleDispute(providerTransactionId: string, disputeId: string) {
    await this.prisma.paymentTransaction.updateMany({
      where: { providerTransactionId },
      data: {
        status: 'DISPUTED',
        metadata: { disputeId },
      },
    });
  }

  private async updateInvoicePayment(invoiceId: string, amount: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (invoice) {
      const newAmountPaid = Number(invoice.amountPaid) + amount;
      const newAmountDue = Number(invoice.totalAmount) - newAmountPaid;

      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: new Prisma.Decimal(newAmountPaid),
          amountDue: new Prisma.Decimal(Math.max(0, newAmountDue)),
          status: newAmountDue <= 0 ? 'PAID' : 'PARTIAL',
        },
      });
    }
  }
}
