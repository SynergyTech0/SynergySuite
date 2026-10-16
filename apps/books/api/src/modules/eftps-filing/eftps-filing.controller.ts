import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import {
  EFTPSFilingService,
  CreateEFTPSEnrollmentDto,
  CreatePayrollTaxFilingDto,
  SubmitEFTPSPaymentDto,
} from './eftps-filing.service';

@Controller('eftps')
@UseGuards(SuiteAuthGuard)
export class EFTPSFilingController {
  constructor(private readonly eftpsService: EFTPSFilingService) {}

  // EFTPS Enrollment
  @Post('enrollment')
  async createEnrollment(@Request() req: any, @Body() dto: CreateEFTPSEnrollmentDto) {
    return this.eftpsService.createEnrollment(req.user.organizationId, dto);
  }

  @Get('enrollment')
  async getEnrollment(@Request() req: any) {
    return this.eftpsService.getEnrollment(req.user.organizationId);
  }

  @Post('enrollment/:id/activate')
  async activateEnrollment(
    @Request() req: any,
    @Param('id') id: string,
    @Body('eftpsPin') eftpsPin: string,
  ) {
    return this.eftpsService.activateEnrollment(req.user.organizationId, id, eftpsPin);
  }

  // Tax Filings
  @Post('filings')
  async createTaxFiling(@Request() req: any, @Body() dto: CreatePayrollTaxFilingDto) {
    return this.eftpsService.createTaxFiling(req.user.organizationId, dto, req.user.id);
  }

  @Get('filings')
  async getTaxFilings(
    @Request() req: any,
    @Query('taxPeriod') taxPeriod?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.eftpsService.getTaxFilings(req.user.organizationId, {
      taxPeriod,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('filings/:id')
  async getTaxFiling(@Request() req: any, @Param('id') id: string) {
    return this.eftpsService.getTaxFiling(req.user.organizationId, id);
  }

  // EFTPS Payments
  @Post('payments')
  async submitEFTPSPayment(@Request() req: any, @Body() dto: SubmitEFTPSPaymentDto) {
    return this.eftpsService.submitEFTPSPayment(req.user.organizationId, dto, req.user.id);
  }

  @Get('transactions')
  async getEFTPSTransactions(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.eftpsService.getEFTPSTransactions(req.user.organizationId, {
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  // Tax Calendar
  @Get('deadlines')
  async getUpcomingTaxDeadlines(@Request() req: any) {
    return this.eftpsService.getUpcomingTaxDeadlines(req.user.organizationId);
  }

  // Tax Calculation
  @Get('payroll/:payrollRunId/calculate')
  async calculatePayrollTaxes(
    @Request() req: any,
    @Param('payrollRunId') payrollRunId: string,
  ) {
    return this.eftpsService.calculatePayrollTaxes(req.user.organizationId, payrollRunId);
  }
}
