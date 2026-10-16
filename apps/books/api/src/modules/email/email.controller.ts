import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Email & Notifications')
@Controller('organizations/:organizationId')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  // Email
  @Post('emails/send')
  @ApiOperation({ summary: 'Send custom email' })
  async sendEmail(@Param('organizationId') organizationId: string, @Body() data: any, @Req() req: any) {
    return this.emailService.sendEmail({ ...data, organizationId, userId: req.user?.id });
  }

  @Post('invoices/:invoiceId/send')
  @ApiOperation({ summary: 'Send invoice via email' })
  async sendInvoice(
    @Param('organizationId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() options?: any,
  ) {
    return this.emailService.sendInvoice(organizationId, invoiceId, options);
  }

  @Post('estimates/:estimateId/send')
  @ApiOperation({ summary: 'Send estimate via email' })
  async sendEstimate(
    @Param('organizationId') organizationId: string,
    @Param('estimateId') estimateId: string,
    @Body() options?: any,
  ) {
    return this.emailService.sendEstimate(organizationId, estimateId, options);
  }

  @Post('payments/:paymentId/send-receipt')
  @ApiOperation({ summary: 'Send payment receipt' })
  async sendPaymentReceipt(
    @Param('organizationId') organizationId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.emailService.sendPaymentReceipt(organizationId, paymentId);
  }

  @Get('emails/log')
  @ApiOperation({ summary: 'Get email log' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getEmailLog(
    @Param('organizationId') organizationId: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.emailService.getEmailLog(organizationId, {
      entityType,
      entityId,
      status,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // Notifications
  @Get('notifications')
  @ApiOperation({ summary: 'Get user notifications' })
  @ApiQuery({ name: 'unreadOnly', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getNotifications(
    @Param('organizationId') organizationId: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.emailService.getNotifications(organizationId, userId, {
      unreadOnly: unreadOnly === 'true',
      type,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Post('notifications/:notificationId/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  async markNotificationRead(
    @Param('organizationId') organizationId: string,
    @Param('notificationId') notificationId: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.emailService.markNotificationRead(organizationId, userId, notificationId);
  }

  @Post('notifications/read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllNotificationsRead(@Param('organizationId') organizationId: string, @Req() req: any) {
    const userId = req.user?.id || 'system';
    return this.emailService.markAllNotificationsRead(organizationId, userId);
  }

  @Delete('notifications/:notificationId')
  @ApiOperation({ summary: 'Delete notification' })
  async deleteNotification(
    @Param('organizationId') organizationId: string,
    @Param('notificationId') notificationId: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.emailService.deleteNotification(organizationId, userId, notificationId);
  }

  // Email Templates
  @Post('email-templates')
  @ApiOperation({ summary: 'Create email template' })
  async createEmailTemplate(@Param('organizationId') organizationId: string, @Body() data: any) {
    return this.emailService.createEmailTemplate(organizationId, data);
  }

  @Get('email-templates')
  @ApiOperation({ summary: 'List email templates' })
  @ApiQuery({ name: 'type', required: false })
  async getEmailTemplates(@Param('organizationId') organizationId: string, @Query('type') type?: string) {
    return this.emailService.getEmailTemplates(organizationId, type);
  }

  @Put('email-templates/:templateId')
  @ApiOperation({ summary: 'Update email template' })
  async updateEmailTemplate(
    @Param('organizationId') organizationId: string,
    @Param('templateId') templateId: string,
    @Body() data: any,
  ) {
    return this.emailService.updateEmailTemplate(organizationId, templateId, data);
  }
}
