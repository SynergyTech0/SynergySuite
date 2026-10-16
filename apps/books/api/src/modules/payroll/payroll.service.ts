import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxCalculator } from './calculators/tax-calculator';
import {
  SetupPayrollDto,
  CreatePayrollRunDto,
  UpdatePaycheckDto,
  EmployeeDeductionSetupDto,
  GenerateW2Dto,
} from './dto/payroll.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculator: TaxCalculator,
  ) {}

  // Payroll Settings
  async setupPayroll(organizationId: string, dto: SetupPayrollDto) {
    const existing = await this.prisma.payrollSettings.findUnique({
      where: { organizationId },
    });

    if (existing) {
      return this.prisma.payrollSettings.update({
        where: { organizationId },
        data: {
          payFrequency: dto.payFrequency,
          defaultPayDay: dto.defaultPayDay,
          federalEIN: dto.federalEIN,
          stateEINs: dto.stateEINs,
          federalDepositSchedule: dto.federalDepositSchedule,
          payrollBankAccountId: dto.payrollBankAccountId,
          directDepositEnabled: dto.directDepositEnabled,
          overtimeThreshold: new Prisma.Decimal(dto.overtimeThreshold || 40),
          overtimeMultiplier: new Prisma.Decimal(dto.overtimeMultiplier || 1.5),
        },
      });
    }

    return this.prisma.payrollSettings.create({
      data: {
        organizationId,
        payFrequency: dto.payFrequency,
        defaultPayDay: dto.defaultPayDay || 5,
        federalEIN: dto.federalEIN,
        stateEINs: dto.stateEINs,
        federalDepositSchedule: dto.federalDepositSchedule,
        payrollBankAccountId: dto.payrollBankAccountId,
        directDepositEnabled: dto.directDepositEnabled || false,
        overtimeThreshold: new Prisma.Decimal(dto.overtimeThreshold || 40),
        overtimeMultiplier: new Prisma.Decimal(dto.overtimeMultiplier || 1.5),
      },
    });
  }

  async getPayrollSettings(organizationId: string) {
    return this.prisma.payrollSettings.findUnique({
      where: { organizationId },
    });
  }

  // Payroll Run
  async createPayrollRun(organizationId: string, dto: CreatePayrollRunDto) {
    const settings = await this.getPayrollSettings(organizationId);
    if (!settings) {
      throw new BadRequestException('Payroll settings not configured');
    }

    // Generate run number
    const lastRun = await this.prisma.payrollRun.findFirst({
      where: { organizationId },
      orderBy: { runNumber: 'desc' },
    });

    const runNumber = lastRun
      ? `PR-${String(parseInt(lastRun.runNumber.split('-')[1] || '0') + 1).padStart(6, '0')}`
      : 'PR-000001';

    // Create payroll run
    const payrollRun = await this.prisma.payrollRun.create({
      data: {
        organizationId,
        settingsId: settings.id,
        runNumber,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        payDate: dto.payDate,
        status: 'DRAFT',
        notes: dto.notes,
      },
    });

    // Get all active employees
    const employees = await this.prisma.employee.findMany({
      where: { organizationId, isActive: true },
      include: {
        deductionSetups: { where: { isActive: true } },
      },
    });

    // Create paychecks for each employee
    for (const employee of employees) {
      const hours = dto.employeeHours?.find((h) => h.employeeId === employee.id);

      await this.createPaycheckForEmployee(
        payrollRun.id,
        employee,
        settings,
        hours,
      );
    }

    return this.getPayrollRun(organizationId, payrollRun.id);
  }

  private async createPaycheckForEmployee(
    payrollRunId: string,
    employee: any,
    settings: any,
    hours?: {
      regularHours?: number;
      overtimeHours?: number;
      ptoHours?: number;
      holidayHours?: number;
      sickHours?: number;
      bonusPay?: number;
      commissionPay?: number;
      memo?: string;
    },
  ) {
    const regularRate = Number(employee.hourlyRate || 0);
    const overtimeRate = regularRate * Number(settings.overtimeMultiplier);

    const regularHours = hours?.regularHours ?? 80; // Default bi-weekly
    const overtimeHours = hours?.overtimeHours ?? 0;
    const ptoHours = hours?.ptoHours ?? 0;
    const holidayHours = hours?.holidayHours ?? 0;
    const sickHours = hours?.sickHours ?? 0;

    // Calculate earnings
    const regularPay = regularHours * regularRate;
    const overtimePay = overtimeHours * overtimeRate;
    const ptoPay = ptoHours * regularRate;
    const holidayPay = holidayHours * regularRate;
    const sickPay = sickHours * regularRate;
    const bonusPay = hours?.bonusPay ?? 0;
    const commissionPay = hours?.commissionPay ?? 0;

    const grossPay = regularPay + overtimePay + ptoPay + holidayPay + sickPay + bonusPay + commissionPay;

    // Get YTD values
    const ytdTotals = await this.getEmployeeYTD(employee.id, new Date().getFullYear());

    // Calculate pre-tax deductions
    const preTaxDeductions = await this.calculatePreTaxDeductions(
      employee.deductionSetups.filter((d: any) => d.isPreTax),
      grossPay,
    );

    // Calculate taxes
    const taxes = this.taxCalculator.calculatePayrollTaxes({
      grossPay,
      ytdGrossPay: ytdTotals.ytdGrossPay,
      filingStatus: 'SINGLE', // Should come from employee W-4
      federalAllowances: 0, // Should come from employee W-4
      stateCode: (employee.address as any)?.state || 'CA',
      stateAllowances: 0,
      preTaxDeductions: preTaxDeductions.total,
      ytdSocialSecurityWages: ytdTotals.ytdSocialSecurityWages,
      ytdMedicareWages: ytdTotals.ytdMedicareWages,
      additionalFederalWithholding: 0,
      additionalStateWithholding: 0,
    });

    // Calculate post-tax deductions
    const postTaxDeductions = await this.calculatePostTaxDeductions(
      employee.deductionSetups.filter((d: any) => !d.isPreTax),
      grossPay,
    );

    const totalDeductions = preTaxDeductions.total + postTaxDeductions.total;
    const totalTaxes = taxes.totalTax;
    const netPay = grossPay - totalDeductions - totalTaxes;
    const totalEmployerTaxes =
      taxes.employerTaxes.socialSecurity +
      taxes.employerTaxes.medicare +
      taxes.employerTaxes.futa +
      taxes.employerTaxes.suta;

    // Create paycheck
    const paycheck = await this.prisma.paycheck.create({
      data: {
        payrollRunId,
        employeeId: employee.id,
        status: 'PENDING',
        regularHours: new Prisma.Decimal(regularHours),
        overtimeHours: new Prisma.Decimal(overtimeHours),
        ptoHours: new Prisma.Decimal(ptoHours),
        holidayHours: new Prisma.Decimal(holidayHours),
        sickHours: new Prisma.Decimal(sickHours),
        regularRate: new Prisma.Decimal(regularRate),
        overtimeRate: new Prisma.Decimal(overtimeRate),
        regularPay: new Prisma.Decimal(regularPay),
        overtimePay: new Prisma.Decimal(overtimePay),
        ptoPay: new Prisma.Decimal(ptoPay),
        holidayPay: new Prisma.Decimal(holidayPay),
        sickPay: new Prisma.Decimal(sickPay),
        bonusPay: new Prisma.Decimal(bonusPay),
        commissionPay: new Prisma.Decimal(commissionPay),
        grossPay: new Prisma.Decimal(grossPay),
        totalDeductions: new Prisma.Decimal(totalDeductions),
        totalTaxes: new Prisma.Decimal(totalTaxes),
        netPay: new Prisma.Decimal(netPay),
        ytdGrossPay: new Prisma.Decimal(ytdTotals.ytdGrossPay + grossPay),
        ytdFederalTax: new Prisma.Decimal(ytdTotals.ytdFederalTax + taxes.federalTax),
        ytdStateTax: new Prisma.Decimal(ytdTotals.ytdStateTax + taxes.stateTax),
        ytdSocialSecurity: new Prisma.Decimal(ytdTotals.ytdSocialSecurityTax + taxes.socialSecurityTax),
        ytdMedicare: new Prisma.Decimal(ytdTotals.ytdMedicareTax + taxes.medicareTax),
        memo: hours?.memo,
      },
    });

    // Create tax line items
    await this.createTaxLineItems(paycheck.id, taxes, ytdTotals);

    // Create deduction line items
    await this.createDeductionLineItems(
      paycheck.id,
      [...preTaxDeductions.items, ...postTaxDeductions.items],
    );

    return paycheck;
  }

  private async getEmployeeYTD(employeeId: string, year: number) {
    const startOfYear = new Date(year, 0, 1);
    const paychecks = await this.prisma.paycheck.findMany({
      where: {
        employeeId,
        payrollRun: {
          payDate: { gte: startOfYear },
          status: 'COMPLETED',
        },
      },
      include: { taxes: true },
    });

    return {
      ytdGrossPay: paychecks.reduce((sum, p) => sum + Number(p.grossPay), 0),
      ytdFederalTax: paychecks.reduce((sum, p) => sum + Number(p.ytdFederalTax), 0),
      ytdStateTax: paychecks.reduce((sum, p) => sum + Number(p.ytdStateTax), 0),
      ytdSocialSecurityWages: paychecks.reduce((sum, p) => sum + Number(p.grossPay), 0),
      ytdMedicareWages: paychecks.reduce((sum, p) => sum + Number(p.grossPay), 0),
      ytdSocialSecurityTax: paychecks.reduce((sum, p) => sum + Number(p.ytdSocialSecurity), 0),
      ytdMedicareTax: paychecks.reduce((sum, p) => sum + Number(p.ytdMedicare), 0),
    };
  }

  private async calculatePreTaxDeductions(deductions: any[], grossPay: number) {
    const items: Array<{ type: string; name: string; amount: number; isPreTax: boolean }> = [];
    let total = 0;

    for (const ded of deductions) {
      let amount = 0;
      if (ded.isPercentage && ded.percentage) {
        amount = grossPay * Number(ded.percentage);
      } else if (ded.amount) {
        amount = Number(ded.amount);
      }

      // Check annual limit
      // (In production, check YTD against annualLimit)

      items.push({
        type: ded.type,
        name: ded.name,
        amount,
        isPreTax: true,
      });
      total += amount;
    }

    return { items, total };
  }

  private async calculatePostTaxDeductions(deductions: any[], grossPay: number) {
    const items: Array<{ type: string; name: string; amount: number; isPreTax: boolean }> = [];
    let total = 0;

    for (const ded of deductions) {
      let amount = 0;
      if (ded.isPercentage && ded.percentage) {
        amount = grossPay * Number(ded.percentage);
      } else if (ded.amount) {
        amount = Number(ded.amount);
      }

      items.push({
        type: ded.type,
        name: ded.name,
        amount,
        isPreTax: false,
      });
      total += amount;
    }

    return { items, total };
  }

  private async createTaxLineItems(paycheckId: string, taxes: any, ytdTotals: any) {
    const taxItems = [
      { taxType: 'FEDERAL', taxableWages: taxes.taxableWages.federal, taxAmount: taxes.federalTax },
      { taxType: 'FICA_SS', taxableWages: taxes.taxableWages.socialSecurity, taxAmount: taxes.socialSecurityTax, employerAmount: taxes.employerTaxes.socialSecurity },
      { taxType: 'FICA_MED', taxableWages: taxes.taxableWages.medicare, taxAmount: taxes.medicareTax, employerAmount: taxes.employerTaxes.medicare },
      { taxType: 'STATE', taxableWages: taxes.taxableWages.state, taxAmount: taxes.stateTax },
    ];

    for (const item of taxItems) {
      if (item.taxAmount > 0 || item.employerAmount) {
        await this.prisma.paycheckTax.create({
          data: {
            paycheckId,
            taxType: item.taxType,
            taxableWages: new Prisma.Decimal(item.taxableWages),
            taxAmount: new Prisma.Decimal(item.taxAmount),
            employerAmount: new Prisma.Decimal(item.employerAmount || 0),
            ytdTaxableWages: new Prisma.Decimal(0), // Would calculate properly
            ytdTaxAmount: new Prisma.Decimal(0),
          },
        });
      }
    }
  }

  private async createDeductionLineItems(
    paycheckId: string,
    deductions: Array<{ type: string; name: string; amount: number; isPreTax: boolean }>,
  ) {
    for (const ded of deductions) {
      if (ded.amount > 0) {
        await this.prisma.paycheckDeduction.create({
          data: {
            paycheckId,
            type: ded.type as any,
            name: ded.name,
            amount: new Prisma.Decimal(ded.amount),
            isPreTax: ded.isPreTax,
            ytdAmount: new Prisma.Decimal(0), // Would calculate properly
          },
        });
      }
    }
  }

  async getPayrollRun(organizationId: string, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, organizationId },
      include: {
        settings: true,
        paychecks: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, email: true } },
            deductions: true,
            taxes: true,
          },
        },
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    return run;
  }

  async listPayrollRuns(
    organizationId: string,
    options: { status?: string; year?: number; limit?: number; offset?: number },
  ) {
    const where: Prisma.PayrollRunWhereInput = {
      organizationId,
      ...(options.status && { status: options.status as any }),
      ...(options.year && {
        payDate: {
          gte: new Date(options.year, 0, 1),
          lt: new Date(options.year + 1, 0, 1),
        },
      }),
    };

    const [runs, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where,
        include: {
          _count: { select: { paychecks: true } },
        },
        orderBy: { payDate: 'desc' },
        take: options.limit || 20,
        skip: options.offset || 0,
      }),
      this.prisma.payrollRun.count({ where }),
    ]);

    return { runs, total };
  }

  async calculatePayrollRun(organizationId: string, runId: string) {
    const run = await this.getPayrollRun(organizationId, runId);

    if (run.status !== 'DRAFT') {
      throw new BadRequestException('Can only calculate draft payroll runs');
    }

    // Recalculate all paychecks
    // This would re-run the tax calculations with any updates

    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        status: 'CALCULATING',
        calculatedAt: new Date(),
        totalGrossPay: new Prisma.Decimal(
          run.paychecks.reduce((sum, p) => sum + Number(p.grossPay), 0),
        ),
        totalDeductions: new Prisma.Decimal(
          run.paychecks.reduce((sum, p) => sum + Number(p.totalDeductions), 0),
        ),
        totalTaxes: new Prisma.Decimal(
          run.paychecks.reduce((sum, p) => sum + Number(p.totalTaxes), 0),
        ),
        totalNetPay: new Prisma.Decimal(
          run.paychecks.reduce((sum, p) => sum + Number(p.netPay), 0),
        ),
        employeeCount: run.paychecks.length,
      },
    });

    // Update status to pending approval
    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'PENDING_APPROVAL' },
    });

    return this.getPayrollRun(organizationId, runId);
  }

  async approvePayrollRun(organizationId: string, runId: string, userId: string) {
    const run = await this.getPayrollRun(organizationId, runId);

    if (run.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Payroll run is not pending approval');
    }

    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: userId,
      },
    });

    // Update all paychecks
    await this.prisma.paycheck.updateMany({
      where: { payrollRunId: runId },
      data: { status: 'APPROVED' },
    });

    return this.getPayrollRun(organizationId, runId);
  }

  async processPayrollRun(organizationId: string, runId: string) {
    const run = await this.getPayrollRun(organizationId, runId);

    if (run.status !== 'APPROVED') {
      throw new BadRequestException('Payroll run must be approved before processing');
    }

    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'PROCESSING' },
    });

    // Create journal entries for payroll
    // This would create the accounting entries

    // Mark as completed
    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });

    await this.prisma.paycheck.updateMany({
      where: { payrollRunId: runId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
      },
    });

    return this.getPayrollRun(organizationId, runId);
  }

  // Employee Deduction Setup
  async setupEmployeeDeduction(organizationId: string, dto: EmployeeDeductionSetupDto) {
    // Verify employee belongs to organization
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.prisma.employeeDeductionSetup.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type as any,
        name: dto.name,
        amount: dto.amount ? new Prisma.Decimal(dto.amount) : null,
        percentage: dto.percentage ? new Prisma.Decimal(dto.percentage) : null,
        isPercentage: dto.isPercentage,
        isPreTax: dto.isPreTax,
        hasEmployerMatch: dto.hasEmployerMatch,
        employerMatchPercent: dto.employerMatchPercent
          ? new Prisma.Decimal(dto.employerMatchPercent)
          : null,
        employerMatchLimit: dto.employerMatchLimit
          ? new Prisma.Decimal(dto.employerMatchLimit)
          : null,
        annualLimit: dto.annualLimit ? new Prisma.Decimal(dto.annualLimit) : null,
        isActive: true,
      },
    });
  }

  async getEmployeeDeductions(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.prisma.employeeDeductionSetup.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // W-2 Generation
  async generateW2s(organizationId: string, dto: GenerateW2Dto) {
    const year = dto.taxYear;
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const whereEmployee: Prisma.EmployeeWhereInput = {
      organizationId,
      ...(dto.employeeId && { id: dto.employeeId }),
    };

    const employees = await this.prisma.employee.findMany({
      where: whereEmployee,
    });

    const w2s = [];

    for (const employee of employees) {
      // Get all paychecks for the year
      const paychecks = await this.prisma.paycheck.findMany({
        where: {
          employeeId: employee.id,
          payrollRun: {
            payDate: { gte: startOfYear, lte: endOfYear },
            status: 'COMPLETED',
          },
        },
        include: { taxes: true, deductions: true },
      });

      if (paychecks.length === 0) continue;

      // Calculate W-2 boxes
      const totalGross = paychecks.reduce((sum, p) => sum + Number(p.grossPay), 0);
      const totalFederalTax = paychecks.reduce(
        (sum, p) => sum + p.taxes.filter((t) => t.taxType === 'FEDERAL').reduce((s, t) => s + Number(t.taxAmount), 0),
        0,
      );
      const totalSocialSecurityWages = paychecks.reduce((sum, p) => sum + Number(p.grossPay), 0);
      const totalSocialSecurityTax = paychecks.reduce(
        (sum, p) => sum + p.taxes.filter((t) => t.taxType === 'FICA_SS').reduce((s, t) => s + Number(t.taxAmount), 0),
        0,
      );
      const totalMedicareWages = paychecks.reduce((sum, p) => sum + Number(p.grossPay), 0);
      const totalMedicareTax = paychecks.reduce(
        (sum, p) => sum + p.taxes.filter((t) => t.taxType === 'FICA_MED').reduce((s, t) => s + Number(t.taxAmount), 0),
        0,
      );

      // Calculate pre-tax deductions for Box 1 adjustment
      const preTaxDeductions = paychecks.reduce(
        (sum, p) => sum + p.deductions.filter((d) => d.isPreTax).reduce((s, d) => s + Number(d.amount), 0),
        0,
      );

      const w2 = await this.prisma.w2Form.upsert({
        where: {
          organizationId_employeeId_taxYear: {
            organizationId,
            employeeId: employee.id,
            taxYear: year,
          },
        },
        update: {
          status: 'GENERATED',
          wagesTipsOther: new Prisma.Decimal(totalGross - preTaxDeductions),
          federalTaxWithheld: new Prisma.Decimal(totalFederalTax),
          socialSecurityWages: new Prisma.Decimal(Math.min(totalSocialSecurityWages, 168600)),
          socialSecurityTax: new Prisma.Decimal(totalSocialSecurityTax),
          medicareWages: new Prisma.Decimal(totalMedicareWages),
          medicareTax: new Prisma.Decimal(totalMedicareTax),
          generatedAt: new Date(),
        },
        create: {
          organizationId,
          employeeId: employee.id,
          taxYear: year,
          status: 'GENERATED',
          wagesTipsOther: new Prisma.Decimal(totalGross - preTaxDeductions),
          federalTaxWithheld: new Prisma.Decimal(totalFederalTax),
          socialSecurityWages: new Prisma.Decimal(Math.min(totalSocialSecurityWages, 168600)),
          socialSecurityTax: new Prisma.Decimal(totalSocialSecurityTax),
          medicareWages: new Prisma.Decimal(totalMedicareWages),
          medicareTax: new Prisma.Decimal(totalMedicareTax),
          generatedAt: new Date(),
        },
      });

      w2s.push(w2);
    }

    return { generated: w2s.length, w2s };
  }

  async getW2s(organizationId: string, taxYear: number) {
    return this.prisma.w2Form.findMany({
      where: { organizationId, taxYear },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, taxId: true } },
      },
    });
  }

  // Paycheck operations
  async getPaycheck(organizationId: string, paycheckId: string) {
    const paycheck = await this.prisma.paycheck.findFirst({
      where: { id: paycheckId, payrollRun: { organizationId } },
      include: {
        payrollRun: true,
        employee: true,
        deductions: true,
        taxes: true,
      },
    });

    if (!paycheck || !paycheck.payrollRun) {
      throw new NotFoundException('Paycheck not found');
    }

    return paycheck;
  }

  async updatePaycheck(organizationId: string, paycheckId: string, dto: UpdatePaycheckDto) {
    const paycheck = await this.getPaycheck(organizationId, paycheckId);

    if (paycheck.status !== 'PENDING' && paycheck.status !== 'CALCULATED') {
      throw new BadRequestException('Cannot modify paycheck in current status');
    }

    return this.prisma.paycheck.update({
      where: { id: paycheckId },
      data: {
        regularHours: dto.regularHours !== undefined ? new Prisma.Decimal(dto.regularHours) : undefined,
        overtimeHours: dto.overtimeHours !== undefined ? new Prisma.Decimal(dto.overtimeHours) : undefined,
        bonusPay: dto.bonusPay !== undefined ? new Prisma.Decimal(dto.bonusPay) : undefined,
        memo: dto.memo,
      },
    });
  }
}
