import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, EmailLog, EmailStatus, EmailTemplateType } from '@prisma/client';

export interface EmailTemplate {
  name: string;
  subject: string;
  body: string;
  variables?: string[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Email Sending
  async sendEmail(data: {
    organizationId: string;
    to: string | string[];
    subject: string;
    body: string;
    cc?: string[];
    bcc?: string[];
    attachments?: Array<{ filename: string; content: string; contentType: string }>;
    entityType?: string;
    entityId?: string;
    userId?: string;
  }) {
    const recipients = Array.isArray(data.to) ? data.to : [data.to];

    // EmailLog stores a single toEmail; keep the full recipient list and sender in metadata
    const email = await this.prisma.emailLog.create({
      data: {
        organizationId: data.organizationId,
        toEmail: recipients.join(', '),
        fromEmail: process.env.EMAIL_FROM || `noreply@${process.env.SUITE_DOMAIN || 'localhost'}`,
        ccEmails: data.cc || [],
        bccEmails: data.bcc || [],
        subject: data.subject,
        bodyHtml: data.body,
        status: EmailStatus.PENDING,
        entityType: data.entityType,
        entityId: data.entityId,
        metadata: {
          recipients,
          ...(data.userId ? { sentBy: data.userId } : {}),
        },
      },
    });

    // In production, would integrate with email service (SendGrid, AWS SES, etc.)
    try {
      await this.sendViaProvider(email);
      
      await this.prisma.emailLog.update({
        where: { id: email.id },
        data: {
          status: EmailStatus.SENT,
          sentAt: new Date(),
        },
      });

      this.logger.log(`Email sent successfully: ${email.id}`);
      return { success: true, emailId: email.id };
    } catch (error) {
      await this.prisma.emailLog.update({
        where: { id: email.id },
        data: {
          status: EmailStatus.FAILED,
          failedAt: new Date(),
          errorMessage: (error as Error).message,
        },
      });

      this.logger.error(`Failed to send email: ${email.id}`, error);
      throw error;
    }
  }

  private async sendViaProvider(email: EmailLog): Promise<void> {
    // Mock email sending - in production, integrate with email service
    this.logger.log(`[MOCK] Sending email to: ${email.toEmail}`);
    this.logger.log(`[MOCK] Subject: ${email.subject}`);
    return Promise.resolve();
  }

  async sendInvoice(organizationId: string, invoiceId: string, options?: {
    to?: string;
    cc?: string[];
    message?: string;
  }) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { customer: true, organization: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    const to = options?.to || invoice.customer.email;
    if (!to) throw new Error('Customer email not found');

    const subject = `Invoice ${invoice.invoiceNumber} from ${invoice.organization.name}`;
    const body = `
      <h2>Invoice ${invoice.invoiceNumber}</h2>
      <p>Dear ${invoice.customer.name},</p>
      <p>${options?.message || 'Please find your invoice attached.'}</p>
      <p><strong>Invoice Date:</strong> ${invoice.invoiceDate.toLocaleDateString()}</p>
      <p><strong>Due Date:</strong> ${invoice.dueDate?.toLocaleDateString()}</p>
      <p><strong>Amount Due:</strong> $${Number(invoice.amountDue).toFixed(2)}</p>
      <p>Thank you for your business!</p>
      <p>${invoice.organization.name}</p>
    `;

    return this.sendEmail({
      organizationId,
      to,
      cc: options?.cc,
      subject,
      body,
      entityType: 'Invoice',
      entityId: invoiceId,
    });
  }

  async sendEstimate(organizationId: string, estimateId: string, options?: {
    to?: string;
    cc?: string[];
    message?: string;
  }) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { id: estimateId, organizationId },
      include: { customer: true, organization: true },
    });

    if (!estimate) throw new NotFoundException('Estimate not found');

    const to = options?.to || estimate.customer.email;
    if (!to) throw new Error('Customer email not found');

    const subject = `Estimate ${estimate.estimateNumber} from ${estimate.organization.name}`;
    const body = `
      <h2>Estimate ${estimate.estimateNumber}</h2>
      <p>Dear ${estimate.customer.name},</p>
      <p>${options?.message || 'Please review the attached estimate.'}</p>
      <p><strong>Estimate Date:</strong> ${estimate.estimateDate.toLocaleDateString()}</p>
      <p><strong>Total Amount:</strong> $${Number(estimate.total).toFixed(2)}</p>
      <p>This estimate is valid until ${estimate.expiryDate.toLocaleDateString()}</p>
      <p>Thank you!</p>
      <p>${estimate.organization.name}</p>
    `;

    return this.sendEmail({
      organizationId,
      to,
      cc: options?.cc,
      subject,
      body,
      entityType: 'Estimate',
      entityId: estimateId,
    });
  }

  async sendPaymentReceipt(organizationId: string, paymentId: string) {
    const payment = await this.prisma.customerPayment.findFirst({
      where: { id: paymentId, organizationId },
      include: { customer: true, organization: true },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (!payment.customer.email) throw new Error('Customer email not found');

    const subject = `Payment Receipt from ${payment.organization.name}`;
    const body = `
      <h2>Payment Receipt</h2>
      <p>Dear ${payment.customer.name},</p>
      <p>Thank you for your payment.</p>
      <p><strong>Amount:</strong> $${Number(payment.amount).toFixed(2)}</p>
      <p><strong>Payment Date:</strong> ${payment.paymentDate.toLocaleDateString()}</p>
      <p><strong>Payment Method:</strong> ${payment.paymentMethod}</p>
      <p><strong>Reference:</strong> ${payment.reference || 'N/A'}</p>
      <p>Thank you for your business!</p>
      <p>${payment.organization.name}</p>
    `;

    return this.sendEmail({
      organizationId,
      to: payment.customer.email,
      subject,
      body,
      entityType: 'Payment',
      entityId: paymentId,
    });
  }

  // Notifications
  async createNotification(data: {
    organizationId: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    priority?: string;
    entityType?: string;
    entityId?: string;
    actionUrl?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        priority: data.priority as any || 'NORMAL',
        entityType: data.entityType,
        entityId: data.entityId,
        actionUrl: data.actionUrl,
        isRead: false,
      },
    });
  }

  async getNotifications(organizationId: string, userId: string, options?: {
    unreadOnly?: boolean;
    type?: string;
    limit?: number;
  }) {
    return this.prisma.notification.findMany({
      where: {
        organizationId,
        userId,
        ...(options?.unreadOnly && { isRead: false }),
        ...(options?.type && { type: options.type as any }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
    });
  }

  async markNotificationRead(organizationId: string, userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId, organizationId },
    });

    if (!notification) throw new NotFoundException('Notification not found');

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllNotificationsRead(organizationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { organizationId, userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async deleteNotification(organizationId: string, userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId, organizationId },
    });

    if (!notification) throw new NotFoundException('Notification not found');

    return this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  // Email Templates
  async createEmailTemplate(organizationId: string, data: {
    name: string;
    type: string;
    subject: string;
    body: string;
    variables?: string[];
    createdBy?: string;
  }) {
    return this.prisma.emailTemplate.create({
      data: {
        organizationId,
        name: data.name,
        type: data.type as EmailTemplateType,
        subject: data.subject,
        bodyHtml: data.body,
        availableFields: data.variables || [],
        isActive: true,
        createdBy: data.createdBy || 'system',
      },
    });
  }

  async getEmailTemplates(organizationId: string, type?: string) {
    return this.prisma.emailTemplate.findMany({
      where: {
        organizationId,
        isActive: true,
        ...(type && { type: type as any }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async updateEmailTemplate(organizationId: string, templateId: string, data: {
    name?: string;
    subject?: string;
    body?: string;
    variables?: string[];
    isActive?: boolean;
  }) {
    const existing = await this.prisma.emailTemplate.findFirst({
      where: { id: templateId, organizationId },
    });

    if (!existing) throw new NotFoundException('Email template not found');

    return this.prisma.emailTemplate.update({
      where: { id: templateId },
      data,
    });
  }

  async getEmailLog(organizationId: string, options?: {
    entityType?: string;
    entityId?: string;
    status?: string;
    limit?: number;
  }) {
    return this.prisma.emailLog.findMany({
      where: {
        organizationId,
        ...(options?.entityType && { entityType: options.entityType }),
        ...(options?.entityId && { entityId: options.entityId }),
        ...(options?.status && { status: options.status as any }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 100,
    });
  }

  // Automated Notifications
  async notifyInvoiceOverdue(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { customer: true },
    });

    if (!invoice || !invoice.dueDate) return;

    const daysOverdue = Math.floor((Date.now() - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000));

    if (daysOverdue > 0 && invoice.customer.email) {
      await this.sendEmail({
        organizationId,
        to: invoice.customer.email,
        subject: `Overdue Invoice Reminder - ${invoice.invoiceNumber}`,
        body: `
          <p>Dear ${invoice.customer.name},</p>
          <p>This is a friendly reminder that invoice ${invoice.invoiceNumber} is now ${daysOverdue} days overdue.</p>
          <p><strong>Amount Due:</strong> $${Number(invoice.amountDue).toFixed(2)}</p>
          <p>Please remit payment at your earliest convenience.</p>
        `,
        entityType: 'Invoice',
        entityId: invoiceId,
      });
    }
  }

  async notifyPaymentReceived(organizationId: string, paymentId: string, userId: string) {
    const payment = await this.prisma.customerPayment.findFirst({
      where: { id: paymentId, organizationId },
      include: { customer: true },
    });

    if (!payment) return;

    await this.createNotification({
      organizationId,
      userId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Received',
      message: `Payment of $${Number(payment.amount).toFixed(2)} received from ${payment.customer.name}`,
      priority: 'NORMAL',
      entityType: 'Payment',
      entityId: paymentId,
    });
  }
}
