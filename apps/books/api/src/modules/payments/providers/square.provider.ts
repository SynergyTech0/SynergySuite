import { Injectable, Logger } from '@nestjs/common';
import { Client, Environment, ApiError } from 'square';

export interface SquareConfig {
  accessToken: string;
  environment: 'sandbox' | 'production';
  locationId: string;
}

export interface SquarePaymentResult {
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

export interface SquareRefundResult {
  id: string;
  status: string;
  amount: number;
  failureReason?: string;
}

@Injectable()
export class SquareProvider {
  private readonly logger = new Logger(SquareProvider.name);
  private clients: Map<string, Client> = new Map();

  getClient(
    gatewayId: string,
    accessToken: string,
    environment: 'sandbox' | 'production' = 'production',
  ): Client {
    if (!this.clients.has(gatewayId)) {
      this.clients.set(
        gatewayId,
        new Client({
          accessToken,
          environment:
            environment === 'sandbox'
              ? Environment.Sandbox
              : Environment.Production,
        }),
      );
    }
    return this.clients.get(gatewayId)!;
  }

  async createPayment(
    client: Client,
    params: {
      locationId: string;
      sourceId: string; // Card nonce or card ID
      amount: number;
      currency: string;
      customerId?: string;
      referenceId?: string;
      note?: string;
      autocomplete?: boolean;
    },
  ): Promise<SquarePaymentResult> {
    try {
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await client.paymentsApi.createPayment({
        idempotencyKey,
        sourceId: params.sourceId,
        amountMoney: {
          amount: BigInt(params.amount),
          currency: params.currency,
        },
        locationId: params.locationId,
        customerId: params.customerId,
        referenceId: params.referenceId,
        note: params.note,
        autocomplete: params.autocomplete ?? true,
      });

      const payment = response.result.payment!;
      const processingFee = payment.processingFee?.[0]?.amountMoney?.amount || BigInt(0);

      return {
        id: payment.id!,
        status: payment.status!,
        amount: Number(payment.amountMoney?.amount || 0),
        currency: payment.amountMoney?.currency || params.currency,
        fee: Number(processingFee),
        netAmount: Number(payment.amountMoney?.amount || 0) - Number(processingFee),
        receiptUrl: payment.receiptUrl,
        failureCode: undefined,
        failureMessage: undefined,
      };
    } catch (error) {
      this.logger.error('Square createPayment failed', error);
      if (error instanceof ApiError) {
        return {
          id: '',
          status: 'FAILED',
          amount: params.amount,
          currency: params.currency,
          fee: 0,
          netAmount: 0,
          failureCode: error.errors?.[0]?.code,
          failureMessage: error.errors?.[0]?.detail,
        };
      }
      throw error;
    }
  }

  async completePayment(
    client: Client,
    paymentId: string,
  ): Promise<SquarePaymentResult> {
    try {
      const response = await client.paymentsApi.completePayment(paymentId, {});
      const payment = response.result.payment!;
      const processingFee = payment.processingFee?.[0]?.amountMoney?.amount || BigInt(0);

      return {
        id: payment.id!,
        status: payment.status!,
        amount: Number(payment.amountMoney?.amount || 0),
        currency: payment.amountMoney?.currency || 'USD',
        fee: Number(processingFee),
        netAmount: Number(payment.amountMoney?.amount || 0) - Number(processingFee),
        receiptUrl: payment.receiptUrl,
      };
    } catch (error) {
      this.logger.error('Square completePayment failed', error);
      throw error;
    }
  }

  async cancelPayment(
    client: Client,
    paymentId: string,
  ): Promise<SquarePaymentResult> {
    try {
      const response = await client.paymentsApi.cancelPayment(paymentId);
      const payment = response.result.payment!;

      return {
        id: payment.id!,
        status: payment.status!,
        amount: Number(payment.amountMoney?.amount || 0),
        currency: payment.amountMoney?.currency || 'USD',
        fee: 0,
        netAmount: 0,
      };
    } catch (error) {
      this.logger.error('Square cancelPayment failed', error);
      throw error;
    }
  }

  async createRefund(
    client: Client,
    params: {
      paymentId: string;
      amount: number;
      currency: string;
      reason?: string;
    },
  ): Promise<SquareRefundResult> {
    try {
      const idempotencyKey = `refund-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await client.refundsApi.refundPayment({
        idempotencyKey,
        paymentId: params.paymentId,
        amountMoney: {
          amount: BigInt(params.amount),
          currency: params.currency,
        },
        reason: params.reason,
      });

      const refund = response.result.refund!;

      return {
        id: refund.id!,
        status: refund.status!,
        amount: Number(refund.amountMoney?.amount || 0),
      };
    } catch (error) {
      this.logger.error('Square createRefund failed', error);
      if (error instanceof ApiError) {
        return {
          id: '',
          status: 'FAILED',
          amount: params.amount,
          failureReason: error.errors?.[0]?.detail,
        };
      }
      throw error;
    }
  }

  async createCustomer(
    client: Client,
    params: {
      email?: string;
      givenName?: string;
      familyName?: string;
      companyName?: string;
      referenceId?: string;
    },
  ): Promise<string> {
    const idempotencyKey = `customer-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const response = await client.customersApi.createCustomer({
      idempotencyKey,
      emailAddress: params.email,
      givenName: params.givenName,
      familyName: params.familyName,
      companyName: params.companyName,
      referenceId: params.referenceId,
    });

    return response.result.customer!.id!;
  }

  async createCard(
    client: Client,
    params: {
      customerId: string;
      sourceId: string; // Card nonce
      billingAddress?: {
        addressLine1?: string;
        addressLine2?: string;
        locality?: string;
        administrativeDistrictLevel1?: string;
        postalCode?: string;
        country?: string;
      };
    },
  ): Promise<{
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  }> {
    const idempotencyKey = `card-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const response = await client.cardsApi.createCard({
      idempotencyKey,
      sourceId: params.sourceId,
      card: {
        customerId: params.customerId,
        billingAddress: params.billingAddress,
      },
    });

    const card = response.result.card!;

    return {
      id: card.id!,
      brand: card.cardBrand || 'UNKNOWN',
      last4: card.last4 || '****',
      expMonth: Number(card.expMonth ?? 0),
      expYear: Number(card.expYear ?? 0),
    };
  }

  async listCards(
    client: Client,
    customerId: string,
  ): Promise<
    Array<{
      id: string;
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    }>
  > {
    const response = await client.cardsApi.listCards(undefined, customerId);

    return (
      response.result.cards?.map((card) => ({
        id: card.id!,
        brand: card.cardBrand || 'UNKNOWN',
        last4: card.last4 || '****',
        expMonth: Number(card.expMonth ?? 0),
        expYear: Number(card.expYear ?? 0),
      })) || []
    );
  }

  async getPayment(client: Client, paymentId: string) {
    const response = await client.paymentsApi.getPayment(paymentId);
    return response.result.payment;
  }

  verifyWebhookSignature(
    payload: string,
    signature: string,
    signatureKey: string,
    notificationUrl: string,
  ): boolean {
    // Square webhook signature verification
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', signatureKey);
    hmac.update(notificationUrl + payload);
    const expectedSignature = hmac.digest('base64');
    return signature === expectedSignature;
  }
}
