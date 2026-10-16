import { appUrl } from '@synergy/config';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ReportExportRequest {
  reportType: string;
  format: 'PDF' | 'EXCEL' | 'CSV';
  parameters: any;
  filters?: any;
}

@Injectable()
export class ReportExportsService {
  private readonly logger = new Logger(ReportExportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createExport(organizationId: string, userId: string, request: ReportExportRequest) {
    const exportRecord = await this.prisma.reportExport.create({
      data: {
        organizationId,
        reportType: request.reportType,
        format: request.format,
        parameters: request.parameters,
        filters: request.filters,
        status: 'QUEUED',
        requestedBy: userId,
      },
    });

    // Process export asynchronously
    this.processExport(exportRecord.id).catch(error => {
      this.logger.error(`Export processing failed: ${exportRecord.id}`, error);
    });

    return exportRecord;
  }

  private async processExport(exportId: string) {
    const exportRecord = await this.prisma.reportExport.findUnique({
      where: { id: exportId },
    });

    if (!exportRecord) return;

    try {
      await this.prisma.reportExport.update({
        where: { id: exportId },
        data: { status: 'PROCESSING', startedAt: new Date() },
      });

      // Generate the report based on type and format
      const reportData = await this.generateReportData(exportRecord);
      const fileContent = await this.formatReport(reportData, exportRecord.format, exportRecord.reportType);

      // In production, would upload to S3 or file storage
      const fileUrl = `${appUrl('books')}/exports/${exportId}.${exportRecord.format.toLowerCase()}`;

      await this.prisma.reportExport.update({
        where: { id: exportId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          fileUrl,
          fileSize: fileContent.length,
        },
      });

      this.logger.log(`Export completed: ${exportId}`);
    } catch (error) {
      await this.prisma.reportExport.update({
        where: { id: exportId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: (error as Error).message,
        },
      });

      this.logger.error(`Export failed: ${exportId}`, error);
    }
  }

  private async generateReportData(exportRecord: any): Promise<any> {
    const { reportType, parameters, organizationId } = exportRecord;

    switch (reportType) {
      case 'PROFIT_LOSS':
        return this.generateProfitLoss(organizationId, parameters);
      case 'BALANCE_SHEET':
        return this.generateBalanceSheet(organizationId, parameters);
      case 'CASH_FLOW':
        return this.generateCashFlow(organizationId, parameters);
      case 'AR_AGING':
        return this.generateARAging(organizationId, parameters);
      case 'AP_AGING':
        return this.generateAPAging(organizationId, parameters);
      case 'GENERAL_LEDGER':
        return this.generateGeneralLedger(organizationId, parameters);
      case 'TRIAL_BALANCE':
        return this.generateTrialBalance(organizationId, parameters);
      case 'SALES_BY_CUSTOMER':
        return this.generateSalesByCustomer(organizationId, parameters);
      case 'EXPENSES_BY_VENDOR':
        return this.generateExpensesByVendor(organizationId, parameters);
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }

  private async generateProfitLoss(organizationId: string, parameters: any) {
    const { startDate, endDate } = parameters;
    
    // Simplified - would need complex accounting logic
    const revenues = await this.prisma.journal.findMany({
      where: {
        organizationId,
        journalDate: { gte: new Date(startDate), lte: new Date(endDate) },
        lines: { some: { account: { accountType: 'REVENUE' } } },
      },
      include: { lines: { include: { account: true } } },
    });

    const expenses = await this.prisma.journal.findMany({
      where: {
        organizationId,
        journalDate: { gte: new Date(startDate), lte: new Date(endDate) },
        lines: { some: { account: { accountType: 'EXPENSE' } } },
      },
      include: { lines: { include: { account: true } } },
    });

    return {
      reportName: 'Profit & Loss Statement',
      period: { startDate, endDate },
      revenues: this.aggregateByAccount(revenues),
      expenses: this.aggregateByAccount(expenses),
    };
  }

  private async generateBalanceSheet(organizationId: string, parameters: any) {
    const { asOfDate } = parameters;

    return {
      reportName: 'Balance Sheet',
      asOfDate,
      assets: [],
      liabilities: [],
      equity: [],
    };
  }

  private async generateCashFlow(organizationId: string, parameters: any) {
    const { startDate, endDate } = parameters;

    return {
      reportName: 'Cash Flow Statement',
      period: { startDate, endDate },
      operatingActivities: [],
      investingActivities: [],
      financingActivities: [],
    };
  }

  private async generateARAging(organizationId: string, parameters: any) {
    const asOfDate = parameters.asOfDate ? new Date(parameters.asOfDate) : new Date();

    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: { not: 'PAID' },
        invoiceDate: { lte: asOfDate },
      },
      include: { customer: { select: { id: true, name: true } } },
    });

    const aging = invoices.map(invoice => {
      const daysOld = Math.floor((asOfDate.getTime() - invoice.invoiceDate.getTime()) / (24 * 60 * 60 * 1000));
      
      return {
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customer.name,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        amount: Number(invoice.amountDue),
        daysOld,
        agingBucket: this.getAgingBucket(daysOld),
      };
    });

    return {
      reportName: 'Accounts Receivable Aging',
      asOfDate,
      invoices: aging,
      summary: this.calculateAgingSummary(aging),
    };
  }

  private async generateAPAging(organizationId: string, parameters: any) {
    const asOfDate = parameters.asOfDate ? new Date(parameters.asOfDate) : new Date();

    const bills = await this.prisma.bill.findMany({
      where: {
        organizationId,
        status: { not: 'PAID' },
        billDate: { lte: asOfDate },
      },
      include: { vendor: { select: { id: true, name: true } } },
    });

    const aging = bills.map(bill => {
      const daysOld = Math.floor((asOfDate.getTime() - bill.billDate.getTime()) / (24 * 60 * 60 * 1000));
      
      return {
        billNumber: bill.billNumber,
        vendorName: bill.vendor.name,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        amount: Number(bill.amountDue),
        daysOld,
        agingBucket: this.getAgingBucket(daysOld),
      };
    });

    return {
      reportName: 'Accounts Payable Aging',
      asOfDate,
      bills: aging,
      summary: this.calculateAgingSummary(aging),
    };
  }

  private async generateGeneralLedger(organizationId: string, parameters: any) {
    const { startDate, endDate, accountId } = parameters;

    const entries = await this.prisma.journal.findMany({
      where: {
        organizationId,
        journalDate: { gte: new Date(startDate), lte: new Date(endDate) },
        ...(accountId && { lines: { some: { accountId } } }),
      },
      include: { lines: { include: { account: true } } },
      orderBy: { journalDate: 'asc' },
    });

    return {
      reportName: 'General Ledger',
      period: { startDate, endDate },
      entries: entries.flatMap(entry => 
        entry.lines.map(line => ({
          date: entry.journalDate,
          entryNumber: entry.journalNumber,
          account: line.account.name,
          accountNumber: line.account.accountNumber,
          description: entry.description,
          debit: Number(line.debit),
          credit: Number(line.credit),
        }))
      ),
    };
  }

  private async generateTrialBalance(organizationId: string, parameters: any) {
    const { asOfDate } = parameters;

    const accounts = await this.prisma.account.findMany({
      where: { organizationId },
      include: { journalLines: { where: { journal: { journalDate: { lte: new Date(asOfDate) } } } } },
    });

    const balances = accounts.map(account => {
      const totalDebit = account.journalLines.reduce((sum, line) => sum + Number(line.debit), 0);
      const totalCredit = account.journalLines.reduce((sum, line) => sum + Number(line.credit), 0);
      const balance = totalDebit - totalCredit;

      return {
        accountNumber: account.accountNumber,
        accountName: account.name,
        accountType: account.accountType,
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? Math.abs(balance) : 0,
      };
    });

    return {
      reportName: 'Trial Balance',
      asOfDate,
      accounts: balances,
      totals: {
        totalDebit: balances.reduce((sum, acc) => sum + acc.debit, 0),
        totalCredit: balances.reduce((sum, acc) => sum + acc.credit, 0),
      },
    };
  }

  private async generateSalesByCustomer(organizationId: string, parameters: any) {
    const { startDate, endDate } = parameters;

    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        invoiceDate: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      include: { customer: { select: { id: true, name: true } } },
    });

    const salesByCustomer = invoices.reduce((acc, invoice) => {
      const customerId = invoice.customer.id;
      if (!acc[customerId]) {
        acc[customerId] = {
          customerName: invoice.customer.name,
          invoiceCount: 0,
          totalSales: 0,
          totalPaid: 0,
          totalDue: 0,
        };
      }
      acc[customerId].invoiceCount++;
      acc[customerId].totalSales += Number(invoice.totalAmount);
      acc[customerId].totalPaid += Number(invoice.amountPaid);
      acc[customerId].totalDue += Number(invoice.amountDue);
      return acc;
    }, {} as Record<string, { customerName: string; invoiceCount: number; totalSales: number; totalPaid: number; totalDue: number }>);

    return {
      reportName: 'Sales by Customer',
      period: { startDate, endDate },
      customers: Object.values(salesByCustomer),
    };
  }

  private async generateExpensesByVendor(organizationId: string, parameters: any) {
    const { startDate, endDate } = parameters;

    const bills = await this.prisma.bill.findMany({
      where: {
        organizationId,
        billDate: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      include: { vendor: { select: { id: true, name: true } } },
    });

    const expensesByVendor = bills.reduce((acc, bill) => {
      const vendorId = bill.vendor.id;
      if (!acc[vendorId]) {
        acc[vendorId] = {
          vendorName: bill.vendor.name,
          billCount: 0,
          totalExpenses: 0,
          totalPaid: 0,
          totalDue: 0,
        };
      }
      acc[vendorId].billCount++;
      acc[vendorId].totalExpenses += Number(bill.totalAmount);
      acc[vendorId].totalPaid += Number(bill.amountPaid);
      acc[vendorId].totalDue += Number(bill.amountDue);
      return acc;
    }, {} as Record<string, { vendorName: string; billCount: number; totalExpenses: number; totalPaid: number; totalDue: number }>);

    return {
      reportName: 'Expenses by Vendor',
      period: { startDate, endDate },
      vendors: Object.values(expensesByVendor),
    };
  }

  private aggregateByAccount(entries: any[]): any[] {
    const accountMap = new Map();
    
    for (const entry of entries) {
      for (const line of entry.lines) {
        const accountId = line.account.id;
        if (!accountMap.has(accountId)) {
          accountMap.set(accountId, {
            accountName: line.account.name,
            accountNumber: line.account.accountNumber,
            total: 0,
          });
        }
        const amount = Number(line.debit) - Number(line.credit);
        accountMap.get(accountId).total += amount;
      }
    }
    
    return Array.from(accountMap.values());
  }

  private getAgingBucket(daysOld: number): string {
    if (daysOld <= 30) return 'Current';
    if (daysOld <= 60) return '31-60 Days';
    if (daysOld <= 90) return '61-90 Days';
    return '90+ Days';
  }

  private calculateAgingSummary(aging: any[]): any {
    return {
      current: aging.filter(a => a.daysOld <= 30).reduce((sum, a) => sum + a.amount, 0),
      days31to60: aging.filter(a => a.daysOld > 30 && a.daysOld <= 60).reduce((sum, a) => sum + a.amount, 0),
      days61to90: aging.filter(a => a.daysOld > 60 && a.daysOld <= 90).reduce((sum, a) => sum + a.amount, 0),
      over90: aging.filter(a => a.daysOld > 90).reduce((sum, a) => sum + a.amount, 0),
      total: aging.reduce((sum, a) => sum + a.amount, 0),
    };
  }

  private async formatReport(data: any, format: string, reportType: string): Promise<string> {
    switch (format) {
      case 'PDF':
        return this.formatAsPDF(data, reportType);
      case 'EXCEL':
        return this.formatAsExcel(data, reportType);
      case 'CSV':
        return this.formatAsCSV(data, reportType);
      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  private formatAsPDF(data: any, reportType: string): string {
    // In production, would use a PDF library like pdfkit or puppeteer
    this.logger.log(`Formatting ${reportType} as PDF`);
    return `[PDF Content for ${reportType}]`;
  }

  private formatAsExcel(data: any, reportType: string): string {
    // In production, would use a library like exceljs
    this.logger.log(`Formatting ${reportType} as Excel`);
    return `[Excel Content for ${reportType}]`;
  }

  private formatAsCSV(data: any, reportType: string): string {
    // Simple CSV formatting
    this.logger.log(`Formatting ${reportType} as CSV`);
    
    if (!data.entries && !data.invoices && !data.bills && !data.customers && !data.vendors && !data.accounts) {
      return 'No data available';
    }

    // Format depends on report type
    const rows = [];
    
    if (data.invoices) {
      rows.push(['Invoice Number', 'Customer', 'Date', 'Due Date', 'Amount', 'Days Old', 'Aging Bucket']);
      data.invoices.forEach((inv: any) => {
        rows.push([
          inv.invoiceNumber,
          inv.customerName,
          inv.invoiceDate,
          inv.dueDate,
          inv.amount,
          inv.daysOld,
          inv.agingBucket,
        ]);
      });
    }
    
    return rows.map(row => row.join(',')).join('\n');
  }

  async getExports(organizationId: string, options?: { status?: string; limit?: number }) {
    return this.prisma.reportExport.findMany({
      where: {
        organizationId,
        ...(options?.status && { status: options.status as any }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
    });
  }

  async getExport(organizationId: string, exportId: string) {
    const exportRecord = await this.prisma.reportExport.findFirst({
      where: { id: exportId, organizationId },
    });

    if (!exportRecord) throw new NotFoundException('Export not found');
    return exportRecord;
  }

  async deleteExport(organizationId: string, exportId: string) {
    const exportRecord = await this.prisma.reportExport.findFirst({
      where: { id: exportId, organizationId },
    });

    if (!exportRecord) throw new NotFoundException('Export not found');

    return this.prisma.reportExport.delete({
      where: { id: exportId },
    });
  }
}
