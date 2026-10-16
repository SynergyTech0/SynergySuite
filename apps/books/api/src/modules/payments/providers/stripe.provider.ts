import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

export interface StripeConfig {
  secretKey: string;
  webhookSecret?: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
  status: string;
  amount: number;
  currency: string;
}

export interface ChargeResult {
  id: string;
  status: string;
  amount: number;
  currency: string;
  fee: number;
  netAmount: number;
  receiptUrl?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface RefundResult {
  id: string;
  status: string;
  amount: number;
  failureReason?: string;
}

@Injectable()
export class StripeProvider {
  private readonly logger = new Logger(StripeProvider.name);
  private clients: Map<string, Stripe> = new Map();

  getClient(gatewayId: string, secretKey: string): Stripe {
    if (!this.clients.has(gatewayId)) {
      this.clients.set(
        gatewayId,
        new Stripe(secretKey, { apiVersion: '2026-09-30.endive' }),
      );
    }
    return this.clients.get(gatewayId)!;
  }

  async createPaymentIntent(
    client: Stripe,
    params: {
      amount: number;
      currency: string;
      customerId?: string;
      paymentMethodId?: string;
      description?: string;
      statementDescriptor?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<PaymentIntentResult> {
    try {
      const intent = await client.paymentIntents.create({
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        description: params.description,
        statement_descriptor: params.statementDescriptor?.substring(0, 22),
        metadata: params.metadata,
        automatic_payment_methods: params.paymentMethodId
          ? undefined
          : { enabled: true },
        confirm: !!params.paymentMethodId,
      });

      return {
        id: intent.id,
        clientSecret: intent.client_secret || '',
        status: intent.status,
        amount: intent.amount,
        currency: intent.currency,
      };
    } catch (error) {
      this.logger.error('Stripe createPaymentIntent failed', error);
      throw error;
    }
  }

  async confirmPaymentIntent(
    client: Stripe,
    paymentIntentId: string,
    paymentMethodId?: string,
  ): Promise<ChargeResult> {
    try {
      const intent = await client.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      const charge = intent.latest_charge
        ? await client.charges.retrieve(intent.latest_charge as string)
        : null;

      return {
        id: intent.id,
        status: intent.status,
        amount: intent.amount,
        currency: intent.currency,
        fee: charge?.balance_transaction
          ? ((await client.balanceTransactions.retrieve(
              charge.balance_transaction as string,
            )).fee || 0)
          : 0,
        netAmount: intent.amount - (charge?.balance_transaction ? 0 : 0),
        receiptUrl: charge?.receipt_url || undefined,
        failureCode: intent.last_payment_error?.code || undefined,
        failureMessage: intent.last_payment_error?.message || undefined,
      };
    } catch (error) {
      this.logger.error('Stripe confirmPaymentIntent failed', error);
      throw error;
    }
  }

  async createCustomer(
    client: Stripe,
    params: {
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<string> {
    const customer = await client.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata,
    });
    return customer.id;
  }

  async attachPaymentMethod(
    client: Stripe,
    paymentMethodId: string,
    customerId: string,
  ): Promise<Stripe.PaymentMethod> {
    const paymentMethod = await client.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
    return paymentMethod;
  }

  async getPaymentMethod(
    client: Stripe,
    paymentMethodId: string,
  ): Promise<Stripe.PaymentMethod> {
    return client.paymentMethods.retrieve(paymentMethodId);
  }

  async listPaymentMethods(
    client: Stripe,
    customerId: string,
    type: Stripe.PaymentMethodListParams.Type = 'card',
  ): Promise<Stripe.PaymentMethod[]> {
    const methods = await client.paymentMethods.list({
      customer: customerId,
      type,
    });
    return methods.data;
  }

  async createRefund(
    client: Stripe,
    params: {
      paymentIntentId: string;
      amount?: number;
      reason?: Stripe.RefundCreateParams.Reason;
    },
  ): Promise<RefundResult> {
    try {
      const refund = await client.refunds.create({
        payment_intent: params.paymentIntentId,
        amount: params.amount,
        reason: params.reason,
      });

      return {
        id: refund.id,
        status: refund.status || 'pending',
        amount: refund.amount,
        failureReason: refund.failure_reason || undefined,
      };
    } catch (error) {
      this.logger.error('Stripe createRefund failed', error);
      throw error;
    }
  }

  async constructWebhookEvent(
    payload: Buffer,
    signature: string,
    webhookSecret: string,
  ): Promise<Stripe.Event> {
    return Stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  async getCharge(client: Stripe, chargeId: string): Promise<Stripe.Charge> {
    return client.charges.retrieve(chargeId);
  }

  async getPaymentIntent(
    client: Stripe,
    paymentIntentId: string,
  ): Promise<Stripe.PaymentIntent> {
    return client.paymentIntents.retrieve(paymentIntentId);
  }
}
