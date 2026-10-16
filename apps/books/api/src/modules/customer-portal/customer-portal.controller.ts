import { Public } from '../auth/guards/suite-auth.guard';
import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { CustomerPortalService } from './customer-portal.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Customer Portal')
@Controller('organizations/:organizationId/customer-portal')
export class CustomerPortalController {
  constructor(private readonly customerPortalService: CustomerPortalService) {}

  // Admin endpoints (require auth)
  @Post('customers/:customerId/access')
  @UseGuards(SuiteAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create portal access for customer' })
  async createPortalAccess(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
    @Body() data: any,
  ) {
    return this.customerPortalService.createPortalAccess(organizationId, customerId, data);
  }

  @Get('customers/:customerId/access')
  @UseGuards(SuiteAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get portal access details' })
  async getPortalAccess(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customerPortalService.getPortalAccess(organizationId, customerId);
  }

  @Put('customers/:customerId/access')
  @UseGuards(SuiteAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update portal access permissions' })
  async updatePortalAccess(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
    @Body() data: any,
  ) {
    return this.customerPortalService.updatePortalAccess(organizationId, customerId, data);
  }

  @Post('customers/:customerId/access/revoke')
  @UseGuards(SuiteAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke portal access' })
  async revokePortalAccess(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customerPortalService.revokePortalAccess(organizationId, customerId);
  }

  @Post('customers/:customerId/access/regenerate')
  @UseGuards(SuiteAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate access token' })
  async regenerateAccessToken(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customerPortalService.regenerateAccessToken(organizationId, customerId);
  }

  @Post('customers/:customerId/send-invite')
  @UseGuards(SuiteAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send portal invitation email' })
  async sendPortalInvite(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customerPortalService.sendPortalInvite(organizationId, customerId);
  }
}

// Public portal endpoints (token-based auth)
@ApiTags('Customer Portal - Public')
@Public()
@Controller('portal')
export class CustomerPortalPublicController {
  constructor(private readonly customerPortalService: CustomerPortalService) {}

  @Get('account')
  @ApiOperation({ summary: 'Get account summary (customer view)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  async getAccountSummary(@Headers('x-portal-token') accessToken: string) {
    return this.customerPortalService.getAccountSummary(accessToken);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Get invoices (customer view)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  @ApiQuery({ name: 'status', required: false })
  async getPortalInvoices(
    @Headers('x-portal-token') accessToken: string,
    @Query('status') status?: string,
  ) {
    return this.customerPortalService.getPortalInvoices(accessToken, { status });
  }

  @Get('invoices/:invoiceId')
  @ApiOperation({ summary: 'Get invoice details (customer view)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  async getPortalInvoice(
    @Headers('x-portal-token') accessToken: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.customerPortalService.getPortalInvoice(accessToken, invoiceId);
  }

  @Get('estimates')
  @ApiOperation({ summary: 'Get estimates (customer view)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  @ApiQuery({ name: 'status', required: false })
  async getPortalEstimates(
    @Headers('x-portal-token') accessToken: string,
    @Query('status') status?: string,
  ) {
    return this.customerPortalService.getPortalEstimates(accessToken, { status });
  }

  @Get('estimates/:estimateId')
  @ApiOperation({ summary: 'Get estimate details (customer view)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  async getPortalEstimate(
    @Headers('x-portal-token') accessToken: string,
    @Param('estimateId') estimateId: string,
  ) {
    return this.customerPortalService.getPortalEstimate(accessToken, estimateId);
  }

  @Post('estimates/:estimateId/accept')
  @ApiOperation({ summary: 'Accept estimate (customer action)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  async acceptEstimate(
    @Headers('x-portal-token') accessToken: string,
    @Param('estimateId') estimateId: string,
    @Body() body: { acceptedBy: string },
  ) {
    return this.customerPortalService.acceptEstimate(accessToken, estimateId, body.acceptedBy);
  }

  @Post('estimates/:estimateId/decline')
  @ApiOperation({ summary: 'Decline estimate (customer action)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  async declineEstimate(
    @Headers('x-portal-token') accessToken: string,
    @Param('estimateId') estimateId: string,
    @Body() body: { reason?: string },
  ) {
    return this.customerPortalService.declineEstimate(accessToken, estimateId, body.reason);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Get payment history (customer view)' })
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  async getPortalPayments(@Headers('x-portal-token') accessToken: string) {
    return this.customerPortalService.getPortalPayments(accessToken);
  }
}
