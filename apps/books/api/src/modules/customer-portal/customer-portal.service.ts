import { appUrl } from '@synergy/config';
import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, EstimateStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class CustomerPortalService {
  private readonly logger = new Logger(CustomerPortalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createPortalAccess(organizationId: string, customerId: string, data?: {
    email?: string;
    allowInvoiceView?: boolean;
    allowPayments?: boolean;
    allowEstimates?: boolean;
    allowDocuments?: boolean;
  }) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) throw new NotFoundException('Customer not found');

    const accessToken = this.generateAccessToken();
    const accessUrl = `${appUrl('books')}/portal/${organizationId}/${accessToken}`;

    return this.prisma.customerPortalAccess.create({
      data: {
        customerId,
        accessToken,
        accessUrl,
        email: data?.email || customer.email,
        isActive: true,
        allowInvoiceView: data?.allowInvoiceView ?? true,
        allowPayments: data?.allowPayments ?? true,
        allowEstimates: data?.allowEstimates ?? true,
        allowDocuments: data?.allowDocuments ?? true,
      },
    });
  }

  private generateAccessToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async getPortalAccess(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) throw new NotFoundException('Customer not found');

    return this.prisma.customerPortalAccess.findFirst({
      where: { customerId },
    });
  }

  async updatePortalAccess(organizationId: string, customerId: string, data: {
    isActive?: boolean;
    allowInvoiceView?: boolean;
    allowPayments?: boolean;
    allowEstimates?: boolean;
    allowDocuments?: boolean;
  }) {
    const access = await this.getPortalAccess(organizationId, customerId);
    
    if (!access) throw new NotFoundException('Portal access not found');

    return this.prisma.customerPortalAccess.update({
      where: { id: access.id },
      data,
    });
  }

  async revokePortalAccess(organizationId: string, customerId: string) {
    const access = await this.getPortalAccess(organizationId, customerId);
    
    if (!access) throw new NotFoundException('Portal access not found');

    return this.prisma.customerPortalAccess.update({
      where: { id: access.id },
      data: { isActive: false },
    });
  }

  async regenerateAccessToken(organizationId: string, customerId: string) {
    const access = await this.getPortalAccess(organizationId, customerId);
    
    if (!access) throw new NotFoundException('Portal access not found');

    const newToken = this.generateAccessToken();
    const newUrl = `${appUrl('books')}/portal/${organizationId}/${newToken}`;

    return this.prisma.customerPortalAccess.update({
      where: { id: access.id },
      data: {
        accessToken: newToken,
        accessUrl: newUrl,
      },
    });
  }

  // Portal Views (for customers accessing their data)
  async authenticatePortal(accessToken: string) {
    const access = await this.prisma.customerPortalAccess.findFirst({
      where: { accessToken, isActive: true },
      include: { customer: { include: { organization: true } } },
    });

    if (!access) throw new UnauthorizedException('Invalid or expired access token');

    // Update last accessed
    await this.prisma.customerPortalAccess.update({
      where: { id: access.id },
      data: { lastAccessedAt: new Date() },
    });

    return {
      customerId: access.customerId,
      organizationId: access.customer.organizationId,
      customerName: access.customer.name,
      organizationName: access.customer.organization.name,
      permissions: {
        allowInvoiceView: access.allowInvoiceView,
        allowPayments: access.allowPayments,
        allowEstimates: access.allowEstimates,
        allowDocuments: access.allowDocuments,
      },
    };
  }

  async getPortalInvoices(accessToken: string, options?: { status?: string }) {
    const auth = await this.authenticatePortal(accessToken);
    
    if (!auth.permissions.allowInvoiceView) {
      throw new UnauthorizedException('Invoice viewing not permitted');
    }

    return this.prisma.invoice.findMany({
      where: {
        customerId: auth.customerId,
        ...(options?.status && { status: options.status as any }),
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        status: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        amountPaid: true,
        amountDue: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });
  }

  async getPortalInvoice(accessToken: string, invoiceId: string) {
    const auth = await this.authenticatePortal(accessToken);
    
    if (!auth.permissions.allowInvoiceView) {
      throw new UnauthorizedException('Invoice viewing not permitted');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, customerId: auth.customerId },
      include: { lineItems: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async getPortalEstimates(accessToken: string, options?: { status?: string }) {
    const auth = await this.authenticatePortal(accessToken);
    
    if (!auth.permissions.allowEstimates) {
      throw new UnauthorizedException('Estimate viewing not permitted');
    }

    const statusFilter =
      options?.status && (Object.values(EstimateStatus) as string[]).includes(options.status)
        ? (options.status as EstimateStatus)
        : undefined;

    const estimates = await this.prisma.estimate.findMany({
      where: {
        customerId: auth.customerId,
        ...(statusFilter && { status: statusFilter }),
      },
      select: {
        id: true,
        estimateNumber: true,
        estimateDate: true,
        expiryDate: true,
        status: true,
        subtotal: true,
        tax: true,
        total: true,
      },
      orderBy: { estimateDate: 'desc' },
    });

    // Keep the portal response keys (expirationDate/taxAmount/totalAmount)
    return estimates.map((e) => ({
      id: e.id,
      estimateNumber: e.estimateNumber,
      estimateDate: e.estimateDate,
      expirationDate: e.expiryDate,
      status: e.status,
      subtotal: e.subtotal,
      taxAmount: e.tax,
      totalAmount: e.total,
    }));
  }

  async getPortalEstimate(accessToken: string, estimateId: string) {
    const auth = await this.authenticatePortal(accessToken);
    
    if (!auth.permissions.allowEstimates) {
      throw new UnauthorizedException('Estimate viewing not permitted');
    }

    const estimate = await this.prisma.estimate.findFirst({
      where: { id: estimateId, customerId: auth.customerId },
      include: { lineItems: true },
    });

    if (!estimate) throw new NotFoundException('Estimate not found');
    return estimate;
  }

  async acceptEstimate(accessToken: string, estimateId: string, acceptedBy: string) {
    const auth = await this.authenticatePortal(accessToken);
    
    if (!auth.permissions.allowEstimates) {
      throw new UnauthorizedException('Estimate actions not permitted');
    }

    const estimate = await this.prisma.estimate.findFirst({
      where: { id: estimateId, customerId: auth.customerId },
    });

    if (!estimate) throw new NotFoundException('Estimate not found');
    if (estimate.status !== 'SENT') {
      throw new BadRequestException('Estimate cannot be accepted');
    }

    return this.prisma.estimate.update({
      where: { id: estimateId },
      data: {
        status: 'ACCEPTED',
        acceptedBy,
        acceptedAt: new Date(),
      },
    });
  }

  async declineEstimate(accessToken: string, estimateId: string, reason?: string) {
    const auth = await this.authenticatePortal(accessToken);
    
    if (!auth.permissions.allowEstimates) {
      throw new UnauthorizedException('Estimate actions not permitted');
    }

    const estimate = await this.prisma.estimate.findFirst({
      where: { id: estimateId, customerId: auth.customerId },
    });

    if (!estimate) throw new NotFoundException('Estimate not found');
    if (estimate.status !== 'SENT') {
      throw new BadRequestException('Estimate cannot be declined');
    }

    return this.prisma.estimate.update({
      where: { id: estimateId },
      data: {
        status: EstimateStatus.REJECTED,
        notes: reason ? `${estimate.notes || ''}\nDecline reason: ${reason}` : estimate.notes,
      },
    });
  }

  async getPortalPayments(accessToken: string) {
    const auth = await this.authenticatePortal(accessToken);

    const payments = await this.prisma.customerPayment.findMany({
      where: { customerId: auth.customerId },
      select: {
        id: true,
        paymentDate: true,
        amount: true,
        paymentMethod: true,
        reference: true,
        status: true,
      },
      orderBy: { paymentDate: 'desc' },
    });

    return payments.map((p) => ({
      id: p.id,
      paymentDate: p.paymentDate,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      referenceNumber: p.reference,
      status: p.status,
    }));
  }

  async getAccountSummary(accessToken: string) {
    const auth = await this.authenticatePortal(accessToken);

    const invoices = await this.prisma.invoice.findMany({
      where: { customerId: auth.customerId },
    });

    const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.amountPaid), 0);
    const totalDue = invoices.reduce((sum, inv) => sum + Number(inv.amountDue), 0);

    const overdueInvoices = invoices.filter(
      inv => inv.status !== 'PAID' && inv.dueDate && new Date(inv.dueDate) < new Date()
    );

    return {
      customerId: auth.customerId,
      customerName: auth.customerName,
      summary: {
        totalInvoiced,
        totalPaid,
        totalDue,
        overdueAmount: overdueInvoices.reduce((sum, inv) => sum + Number(inv.amountDue), 0),
        overdueCount: overdueInvoices.length,
      },
      recentInvoices: invoices.slice(0, 5).map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        status: inv.status,
        totalAmount: inv.totalAmount,
        amountDue: inv.amountDue,
      })),
    };
  }

  async sendPortalInvite(organizationId: string, customerId: string) {
    const access = await this.getPortalAccess(organizationId, customerId);
    
    if (!access) {
      // Create portal access if it doesn't exist
      const newAccess = await this.createPortalAccess(organizationId, customerId);
      return { sent: true, accessUrl: newAccess.accessUrl };
    }

    // In production, would send email with access URL
    this.logger.log(`Sending portal invite to ${access.email} with URL: ${access.accessUrl}`);
    
    return { sent: true, accessUrl: access.accessUrl };
  }
}
