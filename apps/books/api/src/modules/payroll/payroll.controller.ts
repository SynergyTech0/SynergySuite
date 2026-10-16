import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import {
  SetupPayrollDto,
  CreatePayrollRunDto,
  UpdatePaycheckDto,
  EmployeeDeductionSetupDto,
  GenerateW2Dto,
} from './dto/payroll.dto';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Payroll')
@Controller('organizations/:organizationId/payroll')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  // Settings
  @Post('settings')
  @ApiOperation({ summary: 'Setup or update payroll settings' })
  async setupPayroll(
    @Param('organizationId') organizationId: string,
    @Body() dto: SetupPayrollDto,
  ) {
    return this.payrollService.setupPayroll(organizationId, dto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get payroll settings' })
  async getPayrollSettings(@Param('organizationId') organizationId: string) {
    return this.payrollService.getPayrollSettings(organizationId);
  }

  // Payroll Runs
  @Post('runs')
  @ApiOperation({ summary: 'Create a new payroll run' })
  async createPayrollRun(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreatePayrollRunDto,
  ) {
    return this.payrollService.createPayrollRun(organizationId, dto);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List payroll runs' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async listPayrollRuns(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
    @Query('year') year?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.payrollService.listPayrollRuns(organizationId, {
      status,
      year: year ? parseInt(year) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Get payroll run details' })
  async getPayrollRun(
    @Param('organizationId') organizationId: string,
    @Param('runId') runId: string,
  ) {
    return this.payrollService.getPayrollRun(organizationId, runId);
  }

  @Post('runs/:runId/calculate')
  @ApiOperation({ summary: 'Calculate payroll run (finalize tax calculations)' })
  async calculatePayrollRun(
    @Param('organizationId') organizationId: string,
    @Param('runId') runId: string,
  ) {
    return this.payrollService.calculatePayrollRun(organizationId, runId);
  }

  @Post('runs/:runId/approve')
  @ApiOperation({ summary: 'Approve payroll run' })
  async approvePayrollRun(
    @Param('organizationId') organizationId: string,
    @Param('runId') runId: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'system';
    return this.payrollService.approvePayrollRun(organizationId, runId, userId);
  }

  @Post('runs/:runId/process')
  @ApiOperation({ summary: 'Process payroll run (pay employees)' })
  async processPayrollRun(
    @Param('organizationId') organizationId: string,
    @Param('runId') runId: string,
  ) {
    return this.payrollService.processPayrollRun(organizationId, runId);
  }

  // Paychecks
  @Get('paychecks/:paycheckId')
  @ApiOperation({ summary: 'Get paycheck details' })
  async getPaycheck(
    @Param('organizationId') organizationId: string,
    @Param('paycheckId') paycheckId: string,
  ) {
    return this.payrollService.getPaycheck(organizationId, paycheckId);
  }

  @Put('paychecks/:paycheckId')
  @ApiOperation({ summary: 'Update paycheck (before approval)' })
  async updatePaycheck(
    @Param('organizationId') organizationId: string,
    @Param('paycheckId') paycheckId: string,
    @Body() dto: UpdatePaycheckDto,
  ) {
    return this.payrollService.updatePaycheck(organizationId, paycheckId, dto);
  }

  // Employee Deductions
  @Post('deductions')
  @ApiOperation({ summary: 'Setup employee deduction' })
  async setupEmployeeDeduction(
    @Param('organizationId') organizationId: string,
    @Body() dto: EmployeeDeductionSetupDto,
  ) {
    return this.payrollService.setupEmployeeDeduction(organizationId, dto);
  }

  @Get('deductions/:employeeId')
  @ApiOperation({ summary: 'Get employee deductions' })
  async getEmployeeDeductions(
    @Param('organizationId') organizationId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.payrollService.getEmployeeDeductions(organizationId, employeeId);
  }

  // W-2 Forms
  @Post('w2/generate')
  @ApiOperation({ summary: 'Generate W-2 forms for tax year' })
  async generateW2s(
    @Param('organizationId') organizationId: string,
    @Body() dto: GenerateW2Dto,
  ) {
    return this.payrollService.generateW2s(organizationId, dto);
  }

  @Get('w2/:taxYear')
  @ApiOperation({ summary: 'Get W-2 forms for tax year' })
  async getW2s(
    @Param('organizationId') organizationId: string,
    @Param('taxYear') taxYear: string,
  ) {
    return this.payrollService.getW2s(organizationId, parseInt(taxYear));
  }
}
