import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Form1099Service } from './form-1099.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('1099 Forms')
@Controller('organizations/:organizationId/1099')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class Form1099Controller {
  constructor(private readonly form1099Service: Form1099Service) {}

  @Get('eligible-vendors/:taxYear')
  @ApiOperation({ summary: 'Get vendors eligible for 1099' })
  async getEligibleVendors(
    @Param('organizationId') organizationId: string,
    @Param('taxYear') taxYear: string,
  ) {
    return this.form1099Service.getEligibleVendors(organizationId, parseInt(taxYear));
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate 1099 for vendor' })
  async generate1099(
    @Param('organizationId') organizationId: string,
    @Body() body: { vendorId: string; taxYear: number; formType?: string },
  ) {
    return this.form1099Service.generate1099(organizationId, body.vendorId, body.taxYear, body.formType);
  }

  @Post('batch-generate/:taxYear')
  @ApiOperation({ summary: 'Generate 1099s for all eligible vendors' })
  async batchGenerate(
    @Param('organizationId') organizationId: string,
    @Param('taxYear') taxYear: string,
  ) {
    return this.form1099Service.batchGenerate(organizationId, parseInt(taxYear));
  }

  @Get('forms/:taxYear')
  @ApiOperation({ summary: 'List 1099 forms' })
  @ApiQuery({ name: 'status', required: false })
  async get1099s(
    @Param('organizationId') organizationId: string,
    @Param('taxYear') taxYear: string,
    @Query('status') status?: string,
  ) {
    return this.form1099Service.get1099s(organizationId, parseInt(taxYear), status);
  }

  @Get('forms/:taxYear/:formId')
  @ApiOperation({ summary: 'Get 1099 form details' })
  async get1099(
    @Param('organizationId') organizationId: string,
    @Param('formId') formId: string,
  ) {
    return this.form1099Service.get1099(organizationId, formId);
  }

  @Post('forms/:formId/send')
  @ApiOperation({ summary: 'Send 1099 to recipient' })
  async sendToRecipient(
    @Param('organizationId') organizationId: string,
    @Param('formId') formId: string,
    @Body() body: { method: 'EMAIL' | 'MAIL' | 'PORTAL' },
  ) {
    return this.form1099Service.sendToRecipient(organizationId, formId, body.method);
  }

  @Post('forms/:formId/file-irs')
  @ApiOperation({ summary: 'File 1099 with IRS' })
  async fileWithIRS(
    @Param('organizationId') organizationId: string,
    @Param('formId') formId: string,
  ) {
    return this.form1099Service.fileWithIRS(organizationId, formId);
  }

  @Get('summary/:taxYear')
  @ApiOperation({ summary: 'Get 1099 summary for tax year' })
  async get1099Summary(
    @Param('organizationId') organizationId: string,
    @Param('taxYear') taxYear: string,
  ) {
    return this.form1099Service.get1099Summary(organizationId, parseInt(taxYear));
  }
}
