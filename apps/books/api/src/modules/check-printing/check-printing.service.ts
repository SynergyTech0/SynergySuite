import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export class CreateCheckTemplateDto {
  name: string;
  bankAccountId: string;
  paperSize?: string;
  checkPosition?: string;
  includeVoucher?: boolean;
  micrFont?: string;
  payeeNameX?: number;
  payeeNameY?: number;
  amountNumericX?: number;
  amountNumericY?: number;
  amountWordsX?: number;
  amountWordsY?: number;
  dateX?: number;
  dateY?: number;
  memoX?: number;
  memoY?: number;
  signatureLineX?: number;
  signatureLineY?: number;
  logoUrl?: string;
  customCss?: string;
}

export class PrintCheckDto {
  templateId: string;
  payeeType: 'VENDOR' | 'EMPLOYEE' | 'OTHER';
  payeeId?: string;
  payeeName: string;
  payeeAddress?: string;
  amount: number;
  memo?: string;
  billId?: string;
  invoiceIds?: string[];
}

export class CreateCheckBatchDto {
  templateId: string;
  startingCheckNumber: number;
  checks: PrintCheckDto[];
}

@Injectable()
export class CheckPrintingService {
  private readonly logger = new Logger(CheckPrintingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Check Templates
  async createTemplate(organizationId: string, dto: CreateCheckTemplateDto) {
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });

    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    const template = await this.prisma.checkTemplate.create({
      data: {
        organizationId,
        bankAccountId: dto.bankAccountId,
        name: dto.name,
        paperSize: dto.paperSize || 'LETTER',
        checkPosition: dto.checkPosition || 'TOP',
        includeVoucher: dto.includeVoucher ?? true,
        micrFont: dto.micrFont || 'E13B',
        payeeNameX: dto.payeeNameX || 100,
        payeeNameY: dto.payeeNameY || 200,
        amountNumericX: dto.amountNumericX || 500,
        amountNumericY: dto.amountNumericY || 200,
        amountWordsX: dto.amountWordsX || 100,
        amountWordsY: dto.amountWordsY || 250,
        dateX: dto.dateX || 500,
        dateY: dto.dateY || 150,
        memoX: dto.memoX || 100,
        memoY: dto.memoY || 350,
        signatureLineX: dto.signatureLineX || 400,
        signatureLineY: dto.signatureLineY || 400,
        logoUrl: dto.logoUrl,
        customCss: dto.customCss,
        isActive: true,
      },
    });

    this.logger.log(`Check template '${dto.name}' created for org ${organizationId}`);
    return template;
  }

  async getTemplates(organizationId: string) {
    return this.prisma.checkTemplate.findMany({
      where: { organizationId, isActive: true },
      include: {
        bankAccount: {
          select: { id: true, accountName: true, accountNumber: true, routingNumber: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(organizationId: string, templateId: string) {
    const template = await this.prisma.checkTemplate.findFirst({
      where: { id: templateId, organizationId },
      include: { bankAccount: true },
    });

    if (!template) {
      throw new NotFoundException('Check template not found');
    }

    return template;
  }

  async updateTemplate(organizationId: string, templateId: string, dto: Partial<CreateCheckTemplateDto>) {
    const template = await this.getTemplate(organizationId, templateId);

    return this.prisma.checkTemplate.update({
      where: { id: template.id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.paperSize && { paperSize: dto.paperSize }),
        ...(dto.checkPosition && { checkPosition: dto.checkPosition }),
        ...(dto.includeVoucher !== undefined && { includeVoucher: dto.includeVoucher }),
        ...(dto.payeeNameX && { payeeNameX: dto.payeeNameX }),
        ...(dto.payeeNameY && { payeeNameY: dto.payeeNameY }),
        ...(dto.amountNumericX && { amountNumericX: dto.amountNumericX }),
        ...(dto.amountNumericY && { amountNumericY: dto.amountNumericY }),
        ...(dto.amountWordsX && { amountWordsX: dto.amountWordsX }),
        ...(dto.amountWordsY && { amountWordsY: dto.amountWordsY }),
        ...(dto.dateX && { dateX: dto.dateX }),
        ...(dto.dateY && { dateY: dto.dateY }),
        ...(dto.memoX && { memoX: dto.memoX }),
        ...(dto.memoY && { memoY: dto.memoY }),
        ...(dto.signatureLineX && { signatureLineX: dto.signatureLineX }),
        ...(dto.signatureLineY && { signatureLineY: dto.signatureLineY }),
        ...(dto.logoUrl && { logoUrl: dto.logoUrl }),
        ...(dto.customCss && { customCss: dto.customCss }),
      },
    });
  }

  // Single Check Printing
  async printCheck(organizationId: string, dto: PrintCheckDto, userId: string) {
    const template = await this.getTemplate(organizationId, dto.templateId);

    // Get next check number
    const lastCheck = await this.prisma.checkPrint.findFirst({
      where: { templateId: dto.templateId },
      orderBy: { checkNumber: 'desc' },
    });

    const checkNumber = lastCheck ? lastCheck.checkNumber + 1 : 1001;

    const check = await this.prisma.checkPrint.create({
      data: {
        organizationId,
        templateId: dto.templateId,
        checkNumber,
        payeeType: dto.payeeType,
        payeeId: dto.payeeId,
        payeeName: dto.payeeName,
        payeeAddress: dto.payeeAddress,
        amount: new Prisma.Decimal(dto.amount),
        amountWords: this.convertAmountToWords(dto.amount),
        memo: dto.memo,
        checkDate: new Date(),
        status: 'PRINTED',
        billId: dto.billId,
        printedBy: userId,
        printedAt: new Date(),
      },
    });

    // Generate MICR line
    const micrLine = this.generateMICRLine(
      template.bankAccount?.routingNumber ?? '',
      template.bankAccount?.accountNumber ?? '',
      checkNumber.toString(),
    );

    this.logger.log(`Check #${checkNumber} printed for ${dto.payeeName}`);

    return {
      ...check,
      micrLine,
      template,
      printData: this.generateCheckPrintData(check, template),
    };
  }

  // Batch Check Printing
  async createCheckBatch(organizationId: string, dto: CreateCheckBatchDto, userId: string) {
    const template = await this.getTemplate(organizationId, dto.templateId);

    const batch = await this.prisma.checkBatch.create({
      data: {
        organizationId,
        templateId: dto.templateId,
        startingCheckNumber: dto.startingCheckNumber,
        endingCheckNumber: dto.startingCheckNumber + dto.checks.length - 1,
        totalChecks: dto.checks.length,
        totalAmount: new Prisma.Decimal(dto.checks.reduce((sum, c) => sum + c.amount, 0)),
        status: 'PENDING',
        createdBy: userId,
      },
    });

    // Create individual checks
    const checks = await Promise.all(
      dto.checks.map(async (checkDto, index) => {
        const checkNumber = dto.startingCheckNumber + index;

        return this.prisma.checkPrint.create({
          data: {
            organizationId,
            templateId: dto.templateId,
            batchId: batch.id,
            checkNumber,
            payeeType: checkDto.payeeType,
            payeeId: checkDto.payeeId,
            payeeName: checkDto.payeeName,
            payeeAddress: checkDto.payeeAddress,
            amount: new Prisma.Decimal(checkDto.amount),
            amountWords: this.convertAmountToWords(checkDto.amount),
            memo: checkDto.memo,
            checkDate: new Date(),
            status: 'PENDING',
            billId: checkDto.billId,
          },
        });
      }),
    );

    this.logger.log(`Check batch created with ${dto.checks.length} checks`);

    return {
      batch,
      checks,
      template,
    };
  }

  async printBatch(organizationId: string, batchId: string, userId: string) {
    const batch = await this.prisma.checkBatch.findFirst({
      where: { id: batchId, organizationId },
      include: {
        checks: true,
        template: { include: { bankAccount: true } },
      },
    });

    if (!batch) {
      throw new NotFoundException('Check batch not found');
    }

    if (batch.status !== 'PENDING') {
      throw new BadRequestException('Batch has already been printed');
    }

    // Update all checks as printed
    await this.prisma.checkPrint.updateMany({
      where: { batchId },
      data: {
        status: 'PRINTED',
        printedBy: userId,
        printedAt: new Date(),
      },
    });

    // Update batch status
    await this.prisma.checkBatch.update({
      where: { id: batchId },
      data: {
        status: 'PRINTED',
        printedAt: new Date(),
      },
    });

    // Generate print data for all checks
    const printData = batch.checks.map((check) => ({
      ...check,
      micrLine: this.generateMICRLine(
        batch.template?.bankAccount?.routingNumber ?? '',
        batch.template?.bankAccount?.accountNumber ?? '',
        check.checkNumber.toString(),
      ),
      printData: this.generateCheckPrintData(check, batch.template),
    }));

    this.logger.log(`Batch ${batchId} printed with ${batch.checks.length} checks`);

    return {
      batch: { ...batch, status: 'PRINTED' },
      printData,
    };
  }

  async voidCheck(organizationId: string, checkId: string, reason: string, userId: string) {
    const check = await this.prisma.checkPrint.findFirst({
      where: { id: checkId, organizationId },
    });

    if (!check) {
      throw new NotFoundException('Check not found');
    }

    if (check.status === 'VOIDED') {
      throw new BadRequestException('Check is already voided');
    }

    if (check.status === 'CLEARED') {
      throw new BadRequestException('Cannot void a cleared check');
    }

    const voidedCheck = await this.prisma.checkPrint.update({
      where: { id: checkId },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedBy: userId,
        voidReason: reason,
      },
    });

    this.logger.log(`Check #${check.checkNumber} voided: ${reason}`);

    return voidedCheck;
  }

  async getCheckHistory(
    organizationId: string,
    options: {
      templateId?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      payeeName?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.CheckPrintWhereInput = {
      organizationId,
      ...(options.templateId && { templateId: options.templateId }),
      ...(options.status && { status: options.status as any }),
      ...(options.payeeName && { payeeName: { contains: options.payeeName, mode: 'insensitive' as const } }),
      ...(options.startDate || options.endDate
        ? {
            checkDate: {
              ...(options.startDate && { gte: options.startDate }),
              ...(options.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const [checks, total] = await Promise.all([
      this.prisma.checkPrint.findMany({
        where,
        include: {
          template: { select: { name: true, bankAccount: { select: { accountName: true } } } },
        },
        orderBy: { checkDate: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
      }),
      this.prisma.checkPrint.count({ where }),
    ]);

    return { checks, total };
  }

  // Helper Methods
  private generateMICRLine(routingNumber: string, accountNumber: string, checkNumber: string): string {
    // MICR line format: ⑆routing⑆ accountNumber⑈ checkNumber
    // Using E13B MICR characters
    const transitSymbol = '⑆'; // Transit symbol
    const onUsSymbol = '⑈'; // On-Us symbol
    const dashSymbol = '⑉'; // Dash symbol

    return `${transitSymbol}${routingNumber}${transitSymbol} ${accountNumber}${onUsSymbol} ${checkNumber.padStart(6, '0')}`;
  }

  private convertAmountToWords(amount: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    const dollars = Math.floor(amount);
    const cents = Math.round((amount - dollars) * 100);

    const convertHundreds = (num: number): string => {
      if (num === 0) return '';
      if (num < 10) return ones[num];
      if (num < 20) return teens[num - 10];
      if (num < 100) return `${tens[Math.floor(num / 10)]}${num % 10 ? ' ' + ones[num % 10] : ''}`;
      return `${ones[Math.floor(num / 100)]} Hundred${num % 100 ? ' ' + convertHundreds(num % 100) : ''}`;
    };

    const convertNumber = (num: number): string => {
      if (num === 0) return 'Zero';
      if (num < 1000) return convertHundreds(num);
      if (num < 1000000) {
        const thousands = Math.floor(num / 1000);
        const remainder = num % 1000;
        return `${convertHundreds(thousands)} Thousand${remainder ? ' ' + convertHundreds(remainder) : ''}`;
      }
      const millions = Math.floor(num / 1000000);
      const remainder = num % 1000000;
      return `${convertHundreds(millions)} Million${remainder ? ' ' + convertNumber(remainder) : ''}`;
    };

    const dollarsInWords = convertNumber(dollars);
    return `${dollarsInWords} and ${cents.toString().padStart(2, '0')}/100 Dollars`;
  }

  private generateCheckPrintData(check: any, template: any): any {
    return {
      checkNumber: check.checkNumber,
      date: check.checkDate,
      payeeName: check.payeeName,
      payeeAddress: check.payeeAddress,
      amountNumeric: `$${Number(check.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      amountWords: check.amountWords,
      memo: check.memo,
      bankName: template.bankAccount?.name || 'Bank Account',
      positions: {
        payeeName: { x: template.payeeNameX, y: template.payeeNameY },
        amountNumeric: { x: template.amountNumericX, y: template.amountNumericY },
        amountWords: { x: template.amountWordsX, y: template.amountWordsY },
        date: { x: template.dateX, y: template.dateY },
        memo: { x: template.memoX, y: template.memoY },
        signatureLine: { x: template.signatureLineX, y: template.signatureLineY },
      },
      paperSize: template.paperSize,
      checkPosition: template.checkPosition,
      includeVoucher: template.includeVoucher,
      logoUrl: template.logoUrl,
      customCss: template.customCss,
    };
  }
}
