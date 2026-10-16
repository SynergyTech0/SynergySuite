import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportExportsService } from './report-exports.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Report Exports')
@Controller('organizations/:organizationId/report-exports')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class ReportExportsController {
  constructor(private readonly reportExportsService: ReportExportsService) {}

  @Post()
  @ApiOperation({ summary: 'Create report export' })
  async createExport(
    @Param('organizationId') organizationId: string,
    @Body() request: any,
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.reportExportsService.createExport(organizationId, userId, request);
  }

  @Get()
  @ApiOperation({ summary: 'List report exports' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getExports(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportExportsService.getExports(organizationId, {
      status,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get(':exportId')
  @ApiOperation({ summary: 'Get export details' })
  async getExport(@Param('organizationId') organizationId: string, @Param('exportId') exportId: string) {
    return this.reportExportsService.getExport(organizationId, exportId);
  }

  @Delete(':exportId')
  @ApiOperation({ summary: 'Delete export' })
  async deleteExport(@Param('organizationId') organizationId: string, @Param('exportId') exportId: string) {
    return this.reportExportsService.deleteExport(organizationId, exportId);
  }

  // Quick export endpoints for common reports
  @Post('profit-loss')
  @ApiOperation({ summary: 'Export Profit & Loss report' })
  async exportProfitLoss(
    @Param('organizationId') organizationId: string,
    @Body() params: { startDate: string; endDate: string; format: 'PDF' | 'EXCEL' | 'CSV' },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.reportExportsService.createExport(organizationId, userId, {
      reportType: 'PROFIT_LOSS',
      format: params.format,
      parameters: { startDate: params.startDate, endDate: params.endDate },
    });
  }

  @Post('balance-sheet')
  @ApiOperation({ summary: 'Export Balance Sheet report' })
  async exportBalanceSheet(
    @Param('organizationId') organizationId: string,
    @Body() params: { asOfDate: string; format: 'PDF' | 'EXCEL' | 'CSV' },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.reportExportsService.createExport(organizationId, userId, {
      reportType: 'BALANCE_SHEET',
      format: params.format,
      parameters: { asOfDate: params.asOfDate },
    });
  }

  @Post('ar-aging')
  @ApiOperation({ summary: 'Export AR Aging report' })
  async exportARAging(
    @Param('organizationId') organizationId: string,
    @Body() params: { asOfDate?: string; format: 'PDF' | 'EXCEL' | 'CSV' },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.reportExportsService.createExport(organizationId, userId, {
      reportType: 'AR_AGING',
      format: params.format,
      parameters: { asOfDate: params.asOfDate || new Date().toISOString() },
    });
  }

  @Post('ap-aging')
  @ApiOperation({ summary: 'Export AP Aging report' })
  async exportAPAging(
    @Param('organizationId') organizationId: string,
    @Body() params: { asOfDate?: string; format: 'PDF' | 'EXCEL' | 'CSV' },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.reportExportsService.createExport(organizationId, userId, {
      reportType: 'AP_AGING',
      format: params.format,
      parameters: { asOfDate: params.asOfDate || new Date().toISOString() },
    });
  }

  @Post('general-ledger')
  @ApiOperation({ summary: 'Export General Ledger report' })
  async exportGeneralLedger(
    @Param('organizationId') organizationId: string,
    @Body() params: { startDate: string; endDate: string; accountId?: string; format: 'PDF' | 'EXCEL' | 'CSV' },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.reportExportsService.createExport(organizationId, userId, {
      reportType: 'GENERAL_LEDGER',
      format: params.format,
      parameters: { startDate: params.startDate, endDate: params.endDate, accountId: params.accountId },
    });
  }
}
