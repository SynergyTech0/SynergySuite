import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { encryptSecret } from '../../common/crypto.util';

export class CreateEFTPSEnrollmentDto {
  ein: string;
  businessName: string;
  businessAddress: string;
  businessCity: string;
  businessState: string;
  businessZip: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  bankAccountId: string;
}

export class CreatePayrollTaxFilingDto {
  payrollRunId?: string;
  taxPeriod: string; // e.g., '2024-Q1', '2024-01'
  filingFrequency: 'MONTHLY' | 'SEMI_WEEKLY' | 'QUARTERLY';
  federalWithholding: number;
  socialSecurityTax: number;
  medicareTax: number;
  federalUnemployment?: number;
  additionalMedicare?: number;
  totalLiability: number;
  dueDate: Date;
}

export class SubmitEFTPSPaymentDto {
  filingId: string;
  paymentAmount: number;
  settlementDate: Date;
}

@Injectable()
export class EFTPSFilingService {
  private readonly logger = new Logger(EFTPSFilingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // EFTPS Enrollment
  async createEnrollment(organizationId: string, dto: CreateEFTPSEnrollmentDto) {
    // Validate EIN format (XX-XXXXXXX)
    const einRegex = /^\d{2}-\d{7}$/;
    if (!einRegex.test(dto.ein)) {
      throw new BadRequestException('Invalid EIN format. Expected: XX-XXXXXXX');
    }

    // Verify bank account
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });

    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    // Check for existing enrollment
    const existing = await this.prisma.eFTPSEnrollment.findFirst({
      where: { organizationId, ein: dto.ein },
    });

    if (existing) {
      throw new BadRequestException('EFTPS enrollment already exists for this EIN');
    }

    const enrollment = await this.prisma.eFTPSEnrollment.create({
      data: {
        organizationId,
        ein: dto.ein,
        businessName: dto.businessName,
        businessAddress: dto.businessAddress,
        businessCity: dto.businessCity,
        businessState: dto.businessState,
        businessZip: dto.businessZip,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        contactEmail: dto.contactEmail,
        bankAccountId: dto.bankAccountId,
        enrollmentStatus: 'PENDING',
      },
    });

    this.logger.log(`EFTPS enrollment created for EIN ${dto.ein}`);

    return enrollment;
  }

  async getEnrollment(organizationId: string) {
    return this.prisma.eFTPSEnrollment.findFirst({
      where: { organizationId },
      include: {
        bankAccount: {
          select: { accountName: true, accountNumber: true, routingNumber: true },
        },
      },
    });
  }

  async activateEnrollment(organizationId: string, enrollmentId: string, eftpsPin: string) {
    const enrollment = await this.prisma.eFTPSEnrollment.findFirst({
      where: { id: enrollmentId, organizationId },
    });

    if (!enrollment) {
      throw new NotFoundException('EFTPS enrollment not found');
    }

    // In production, validate PIN with IRS
    // For now, just update status

    await this.prisma.eFTPSEnrollment.update({
      where: { id: enrollmentId },
      data: {
        enrollmentStatus: 'ACTIVE',
        eftpsPin: encryptSecret(eftpsPin),
        enrolledAt: new Date(),
      },
    });

    this.logger.log(`EFTPS enrollment ${enrollmentId} activated`);

    return { success: true, status: 'ACTIVE' };
  }

  // Payroll Tax Filing
  async createTaxFiling(organizationId: string, dto: CreatePayrollTaxFilingDto, userId: string) {
    // Validate enrollment exists and is active
    const enrollment = await this.prisma.eFTPSEnrollment.findFirst({
      where: { organizationId, enrollmentStatus: 'ACTIVE' },
    });

    if (!enrollment) {
      throw new BadRequestException('Active EFTPS enrollment required');
    }

    // Calculate tax categories
    const form941Taxes = dto.federalWithholding + dto.socialSecurityTax + dto.medicareTax;

    const filing = await this.prisma.payrollTaxFiling.create({
      data: {
        organizationId,
        payrollRunId: dto.payrollRunId,
        taxPeriod: dto.taxPeriod,
        filingFrequency: dto.filingFrequency,
        federalWithholding: new Prisma.Decimal(dto.federalWithholding),
        socialSecurityTax: new Prisma.Decimal(dto.socialSecurityTax),
        medicareTax: new Prisma.Decimal(dto.medicareTax),
        federalUnemployment: dto.federalUnemployment
          ? new Prisma.Decimal(dto.federalUnemployment)
          : null,
        additionalMedicare: dto.additionalMedicare
          ? new Prisma.Decimal(dto.additionalMedicare)
          : null,
        totalTaxDue: new Prisma.Decimal(dto.totalLiability),
        form941Liability: new Prisma.Decimal(form941Taxes),
        dueDate: dto.dueDate,
        status: 'PENDING',
        createdBy: userId,
      },
    });

    this.logger.log(`Payroll tax filing created for period ${dto.taxPeriod}`);

    return filing;
  }

  async getTaxFilings(
    organizationId: string,
    options?: {
      taxPeriod?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.PayrollTaxFilingWhereInput = {
      organizationId,
      ...(options?.taxPeriod && { taxPeriod: options.taxPeriod }),
      ...(options?.status && { status: options.status as any }),
      ...(options?.startDate || options?.endDate
        ? {
            dueDate: {
              ...(options?.startDate && { gte: options.startDate }),
              ...(options?.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const [filings, total] = await Promise.all([
      this.prisma.payrollTaxFiling.findMany({
        where,
        include: {
          payrollRun: {
            select: { periodStart: true, periodEnd: true },
          },
          deposits: {
            select: { id: true, amount: true, status: true, scheduledDate: true },
          },
        },
        orderBy: { dueDate: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.payrollTaxFiling.count({ where }),
    ]);

    return { filings, total };
  }

  async getTaxFiling(organizationId: string, filingId: string) {
    const filing = await this.prisma.payrollTaxFiling.findFirst({
      where: { id: filingId, organizationId },
      include: {
        payrollRun: true,
        deposits: true,
      },
    });

    if (!filing) {
      throw new NotFoundException('Tax filing not found');
    }

    return filing;
  }

  // EFTPS Payment Submission
  async submitEFTPSPayment(organizationId: string, dto: SubmitEFTPSPaymentDto, userId: string) {
    const filing = await this.getTaxFiling(organizationId, dto.filingId);

    const enrollment = await this.prisma.eFTPSEnrollment.findFirst({
      where: { organizationId, enrollmentStatus: 'ACTIVE' },
      include: { bankAccount: true },
    });

    if (!enrollment) {
      throw new BadRequestException('Active EFTPS enrollment required');
    }

    // Generate confirmation number
    const confirmationNumber = await this.generateConfirmationNumber();

    // Create EFTPS transaction
    const transaction = await this.prisma.eFTPSTransaction.create({
      data: {
        filingId: dto.filingId,
        enrollmentId: enrollment.id,
        taxType: 'FEDERAL_941',
        taxPeriod: filing.taxPeriod,
        amount: new Prisma.Decimal(dto.paymentAmount),
        scheduledDate: dto.settlementDate,
        eftpsConfirmation: confirmationNumber,
        status: 'SCHEDULED',
        submittedBy: userId,
        submittedAt: new Date(),
      },
    });

    // Update filing status
    await this.prisma.payrollTaxFiling.update({
      where: { id: dto.filingId },
      data: { status: 'SCHEDULED' },
    });

    this.logger.log(
      `EFTPS payment scheduled: $${dto.paymentAmount} for ${filing.taxPeriod} (Confirmation: ${confirmationNumber})`,
    );

    return {
      transactionId: transaction.id,
      confirmationNumber,
      amount: dto.paymentAmount,
      scheduledDate: dto.settlementDate,
      status: 'SCHEDULED',
    };
  }

  async getEFTPSTransactions(
    organizationId: string,
    options?: {
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const enrollment = await this.getEnrollment(organizationId);
    if (!enrollment) {
      return { transactions: [], total: 0 };
    }

    const where: Prisma.EFTPSTransactionWhereInput = {
      enrollmentId: enrollment.id,
      ...(options?.status && { status: options.status as any }),
      ...(options?.startDate || options?.endDate
        ? {
            scheduledDate: {
              ...(options?.startDate && { gte: options.startDate }),
              ...(options?.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.eFTPSTransaction.findMany({
        where,
        include: {
          filing: {
            select: { taxPeriod: true, totalTaxDue: true },
          },
        },
        orderBy: { scheduledDate: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.eFTPSTransaction.count({ where }),
    ]);

    return { transactions, total };
  }

  // Tax Calendar and Reminders
  async getUpcomingTaxDeadlines(organizationId: string) {
    const today = new Date();
    const threeMonthsOut = new Date();
    threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);

    const filings = await this.prisma.payrollTaxFiling.findMany({
      where: {
        organizationId,
        dueDate: { gte: today, lte: threeMonthsOut },
        status: { in: ['PENDING', 'SCHEDULED'] },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Add standard IRS deadlines
    const standardDeadlines = this.getIRSPayrollDeadlines(today, threeMonthsOut);

    return {
      pendingFilings: filings,
      irsDeadlines: standardDeadlines,
    };
  }

  async calculatePayrollTaxes(
    organizationId: string,
    payrollRunId: string,
  ) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: { id: payrollRunId, organizationId },
      include: {
        paychecks: true,
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    // Calculate tax totals from payroll items
    let federalWithholding = 0;
    let socialSecurityTax = 0;
    let medicareTax = 0;
    let additionalMedicare = 0;

    for (const item of payrollRun.paychecks) {
      federalWithholding += Number(item.federalTax || 0);
      socialSecurityTax += Number(item.socialSecurityTax || 0);
      medicareTax += Number(item.medicareTax || 0);
      // Additional Medicare for wages over $200k
      if (item.additionalMedicareTax) {
        additionalMedicare += Number(item.additionalMedicareTax);
      }
    }

    // Employer match for SS and Medicare
    const employerSocialSecurity = socialSecurityTax;
    const employerMedicare = medicareTax;

    const totalLiability =
      federalWithholding +
      socialSecurityTax * 2 + // Employee + Employer
      medicareTax * 2 + // Employee + Employer
      additionalMedicare;

    // Determine filing frequency and due date
    const { filingFrequency, dueDate } = this.determineDueDateAndFrequency(
      totalLiability,
      payrollRun.periodEnd,
    );

    return {
      payrollRunId,
      taxPeriod: this.getTaxPeriod(payrollRun.periodEnd, filingFrequency),
      filingFrequency,
      federalWithholding,
      socialSecurityTax: socialSecurityTax * 2, // Total (employee + employer)
      medicareTax: medicareTax * 2, // Total (employee + employer)
      additionalMedicare,
      totalLiability,
      dueDate,
      breakdown: {
        employeeFederalWithholding: federalWithholding,
        employeeSocialSecurity: socialSecurityTax,
        employerSocialSecurity,
        employeeMedicare: medicareTax,
        employerMedicare,
        additionalMedicare,
      },
    };
  }

  // Auto-filing (scheduled job)
  async processScheduledPayments() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const scheduledTransactions = await this.prisma.eFTPSTransaction.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledDate: { lte: today },
      },
      include: {
        enrollment: true,
        filing: true,
      },
    });

    const results: Array<{ transactionId: string; confirmationNumber: string | null; status: string; error?: string }> = [];
    for (const transaction of scheduledTransactions) {
      try {
        // In production, submit to IRS EFTPS system
        // For now, simulate successful processing

        await this.prisma.eFTPSTransaction.update({
          where: { id: transaction.id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
          },
        });

        if (transaction.filingId) {
          await this.prisma.payrollTaxFiling.update({
            where: { id: transaction.filingId },
            data: { status: 'PAID' },
          });
        }

        results.push({
          transactionId: transaction.id,
          confirmationNumber: transaction.eftpsConfirmation,
          status: 'PROCESSED',
        });

        this.logger.log(
          `EFTPS payment processed: ${transaction.eftpsConfirmation}`,
        );
      } catch (error) {
        await this.prisma.eFTPSTransaction.update({
          where: { id: transaction.id },
          data: {
            status: 'FAILED',
            errorMessage: (error as Error).message,
          },
        });

        results.push({
          transactionId: transaction.id,
          confirmationNumber: transaction.eftpsConfirmation,
          status: 'FAILED',
          error: (error as Error).message,
        });
      }
    }

    return results;
  }

  // Helper Methods
  private async generateConfirmationNumber(): Promise<string> {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `EFTPS${timestamp}${random}`;
  }

  private determineDueDateAndFrequency(
    totalLiability: number,
    payPeriodEnd: Date,
  ): { filingFrequency: 'MONTHLY' | 'SEMI_WEEKLY' | 'QUARTERLY'; dueDate: Date } {
    // IRS deposit schedule rules
    // Less than $50,000 liability in lookback period: Monthly
    // $50,000 or more: Semi-weekly

    // Simplified logic - in production, check actual lookback period
    const isLargeEmployer = totalLiability > 5000;

    if (isLargeEmployer) {
      // Semi-weekly depositor
      // Wed-Fri paydays: Due following Wednesday
      // Sat-Tue paydays: Due following Friday
      const dayOfWeek = payPeriodEnd.getDay();
      const dueDate = new Date(payPeriodEnd);

      if (dayOfWeek >= 3 && dayOfWeek <= 5) {
        // Wed-Fri: Due next Wednesday
        dueDate.setDate(dueDate.getDate() + ((3 + 7 - dayOfWeek) % 7) + 7);
      } else {
        // Sat-Tue: Due next Friday
        dueDate.setDate(dueDate.getDate() + ((5 + 7 - dayOfWeek) % 7));
        if (dueDate <= payPeriodEnd) {
          dueDate.setDate(dueDate.getDate() + 7);
        }
      }

      return { filingFrequency: 'SEMI_WEEKLY', dueDate };
    } else {
      // Monthly depositor - Due by 15th of following month
      const dueDate = new Date(payPeriodEnd);
      dueDate.setMonth(dueDate.getMonth() + 1);
      dueDate.setDate(15);

      return { filingFrequency: 'MONTHLY', dueDate };
    }
  }

  private getTaxPeriod(
    date: Date,
    frequency: 'MONTHLY' | 'SEMI_WEEKLY' | 'QUARTERLY',
  ): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    if (frequency === 'QUARTERLY') {
      const quarter = Math.ceil(month / 3);
      return `${year}-Q${quarter}`;
    }

    return `${year}-${month.toString().padStart(2, '0')}`;
  }

  private getIRSPayrollDeadlines(startDate: Date, endDate: Date): any[] {
    const deadlines: Array<{ type: string; description: string; dueDate: Date }> = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const year = current.getFullYear();
      const month = current.getMonth();

      // Form 941 quarterly deadlines
      const quarterlyDates = [
        { month: 3, day: 30, quarter: 1 }, // Q1: April 30
        { month: 6, day: 31, quarter: 2 }, // Q2: July 31
        { month: 9, day: 31, quarter: 3 }, // Q3: October 31
        { month: 0, day: 31, quarter: 4 }, // Q4: January 31 (next year)
      ];

      for (const qd of quarterlyDates) {
        const deadlineYear = qd.quarter === 4 ? year + 1 : year;
        const deadline = new Date(deadlineYear, qd.month, qd.day);

        if (deadline >= startDate && deadline <= endDate) {
          deadlines.push({
            type: 'FORM_941',
            description: `Form 941 - Q${qd.quarter} ${qd.quarter === 4 ? year : year}`,
            dueDate: deadline,
          });
        }
      }

      current.setMonth(current.getMonth() + 1);
    }

    // Form 940 annual deadline (January 31)
    const form940Deadline = new Date(startDate.getFullYear() + 1, 0, 31);
    if (form940Deadline >= startDate && form940Deadline <= endDate) {
      deadlines.push({
        type: 'FORM_940',
        description: `Form 940 - Annual FUTA Tax Return ${startDate.getFullYear()}`,
        dueDate: form940Deadline,
      });
    }

    return deadlines.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }
}
