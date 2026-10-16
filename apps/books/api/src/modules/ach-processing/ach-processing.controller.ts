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
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import {
  ACHProcessingService,
  AddEmployeeBankAccountDto,
  AddVendorBankAccountDto,
  CreateACHBatchDto,
} from './ach-processing.service';

@Controller('ach')
@UseGuards(SuiteAuthGuard)
export class ACHProcessingController {
  constructor(private readonly achService: ACHProcessingService) {}

  // Employee Bank Accounts
  @Post('employees/:employeeId/bank-accounts')
  async addEmployeeBankAccount(
    @Request() req: any,
    @Param('employeeId') employeeId: string,
    @Body() dto: Omit<AddEmployeeBankAccountDto, 'employeeId'>,
  ) {
    return this.achService.addEmployeeBankAccount(req.user.organizationId, {
      ...dto,
      employeeId,
    });
  }

  @Get('employees/:employeeId/bank-accounts')
  async getEmployeeBankAccounts(
    @Request() req: any,
    @Param('employeeId') employeeId: string,
  ) {
    return this.achService.getEmployeeBankAccounts(req.user.organizationId, employeeId);
  }

  @Post('employees/:employeeId/bank-accounts/:bankAccountId/verify')
  async verifyEmployeeBankAccount(
    @Request() req: any,
    @Param('employeeId') employeeId: string,
    @Param('bankAccountId') bankAccountId: string,
    @Body() microDeposits: { amount1: number; amount2: number },
  ) {
    return this.achService.verifyEmployeeBankAccount(
      req.user.organizationId,
      employeeId,
      bankAccountId,
      microDeposits,
    );
  }

  // Vendor Bank Accounts
  @Post('vendors/:vendorId/bank-accounts')
  async addVendorBankAccount(
    @Request() req: any,
    @Param('vendorId') vendorId: string,
    @Body() dto: Omit<AddVendorBankAccountDto, 'vendorId'>,
  ) {
    return this.achService.addVendorBankAccount(req.user.organizationId, {
      ...dto,
      vendorId,
    });
  }

  @Get('vendor-bank-accounts')
  async getVendorBankAccounts(@Request() req: any) {
    return this.achService.getVendorBankAccounts(req.user.organizationId);
  }

  // ACH Batches
  @Post('batches')
  async createACHBatch(@Request() req: any, @Body() dto: CreateACHBatchDto) {
    return this.achService.createACHBatch(req.user.organizationId, dto, req.user.id);
  }

  @Get('batches')
  async getACHBatches(
    @Request() req: any,
    @Query('batchType') batchType?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.achService.getACHBatches(req.user.organizationId, {
      batchType,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('batches/:id')
  async getACHBatchDetails(@Request() req: any, @Param('id') id: string) {
    return this.achService.getACHBatchDetails(req.user.organizationId, id);
  }

  @Post('batches/:id/generate-nacha')
  async generateNACHAFile(
    @Request() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const result = await this.achService.generateNACHAFile(req.user.organizationId, id);

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.send(result.content);
  }

  @Post('batches/:id/submit')
  async submitACHBatch(@Request() req: any, @Param('id') id: string) {
    return this.achService.submitACHBatch(req.user.organizationId, id);
  }

  // Payroll Direct Deposit
  @Post('payroll/:payrollRunId/direct-deposit')
  async createPayrollDirectDeposit(
    @Request() req: any,
    @Param('payrollRunId') payrollRunId: string,
    @Body('effectiveDate') effectiveDate: string,
  ) {
    return this.achService.createPayrollDirectDeposit(
      req.user.organizationId,
      payrollRunId,
      new Date(effectiveDate),
      req.user.id,
    );
  }
}
