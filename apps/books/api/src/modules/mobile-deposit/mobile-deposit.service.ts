import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, IsIn, IsPositive } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export class CreateMobileDepositDto {
  @IsString()
  bankAccountId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsOptional()
  checkNumber?: string;

  @IsString()
  @IsOptional()
  payerName?: string;

  @IsString()
  @IsOptional()
  payerAddress?: string;

  @IsString()
  @IsOptional()
  memo?: string;

  @IsString()
  frontImageBase64: string;

  @IsString()
  backImageBase64: string;
}

export class ReviewDepositDto {
  @IsIn(['APPROVE', 'REJECT'])
  action: 'APPROVE' | 'REJECT';

  @IsString()
  @IsOptional()
  reason?: string;

  @IsNumber()
  @IsOptional()
  adjustedAmount?: number;
}

@Injectable()
export class MobileDepositService {
  private readonly logger = new Logger(MobileDepositService.name);

  // Daily deposit limits by account type
  private readonly DAILY_LIMITS = {
    BASIC: 2500,
    STANDARD: 5000,
    PREMIUM: 10000,
    BUSINESS: 25000,
  };

  // Individual check limits
  private readonly CHECK_LIMITS = {
    BASIC: 1000,
    STANDARD: 2500,
    PREMIUM: 5000,
    BUSINESS: 10000,
  };

  constructor(private readonly prisma: PrismaService) {}

  async createDeposit(
    organizationId: string,
    dto: CreateMobileDepositDto,
    userId: string,
  ) {
    // Verify bank account
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });

    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    // Get organization tier for limits
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    const tier = (organization?.subscriptionTier as keyof typeof this.DAILY_LIMITS) || 'STANDARD';
    const dailyLimit = this.DAILY_LIMITS[tier] || this.DAILY_LIMITS.STANDARD;
    const checkLimit = this.CHECK_LIMITS[tier] || this.CHECK_LIMITS.STANDARD;

    // Check individual check limit
    if (dto.amount > checkLimit) {
      throw new BadRequestException(
        `Check amount exceeds limit of $${checkLimit.toLocaleString()}`,
      );
    }

    // Check daily deposit limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dailyDeposits = await this.prisma.mobileDeposit.aggregate({
      where: {
        organizationId,
        bankAccountId: dto.bankAccountId,
        createdAt: { gte: today, lt: tomorrow },
        status: { in: ['PENDING', 'APPROVED', 'CLEARED'] },
      },
      _sum: { checkAmount: true },
    });

    const currentDailyTotal = Number(dailyDeposits._sum.checkAmount || 0);
    if (currentDailyTotal + dto.amount > dailyLimit) {
      throw new BadRequestException(
        `Daily deposit limit of $${dailyLimit.toLocaleString()} would be exceeded`,
      );
    }

    // Validate images
    this.validateCheckImages(dto.frontImageBase64, dto.backImageBase64);

    // Process check images (in production, use OCR/ICR service)
    const extractedData = await this.processCheckImages(
      dto.frontImageBase64,
      dto.backImageBase64,
    );

    // Generate reference number
    const referenceNumber = await this.generateReferenceNumber(organizationId);

    const deposit = await this.prisma.mobileDeposit.create({
      data: {
        organizationId,
        bankAccountId: dto.bankAccountId,
        referenceNumber,
        checkAmount: new Prisma.Decimal(dto.amount),
        checkNumber: dto.checkNumber || extractedData.checkNumber,
        payerName: dto.payerName || extractedData.payerName,
        payerAddress: dto.payerAddress,
        notes: dto.memo,
        frontImagePath: await this.storeImage(dto.frontImageBase64, 'front', referenceNumber),
        backImagePath: await this.storeImage(dto.backImageBase64, 'back', referenceNumber),
        ocrConfidence: extractedData.confidence,
        micr: extractedData.micr,
        routingNumber: extractedData.routingNumber,
        accountNumber: extractedData.accountNumber,
        status: 'PENDING',
        uploadedBy: userId,
        uploadedAt: new Date(),
      },
    });

    this.logger.log(
      `Mobile deposit ${referenceNumber} created for $${dto.amount}`,
    );

    return {
      id: deposit.id,
      referenceNumber: deposit.referenceNumber,
      amount: dto.amount,
      status: deposit.status,
      estimatedAvailability: this.calculateAvailabilityDate(dto.amount),
      extractedData: {
        checkNumber: extractedData.checkNumber,
        payerName: extractedData.payerName,
        micr: extractedData.micr ? '****' + extractedData.micr.slice(-4) : null,
        confidence: extractedData.confidence,
      },
    };
  }

  async getDeposits(
    organizationId: string,
    options?: {
      bankAccountId?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.MobileDepositWhereInput = {
      organizationId,
      ...(options?.bankAccountId && { bankAccountId: options.bankAccountId }),
      ...(options?.status && { status: options.status as any }),
      ...(options?.startDate || options?.endDate
        ? {
            uploadedAt: {
              ...(options?.startDate && { gte: options.startDate }),
              ...(options?.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const [deposits, total] = await Promise.all([
      this.prisma.mobileDeposit.findMany({
        where,
        include: {
          bankAccount: { select: { accountName: true, accountNumber: true } },
        },
        orderBy: { uploadedAt: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.mobileDeposit.count({ where }),
    ]);

    return { deposits, total };
  }

  async getDeposit(organizationId: string, depositId: string) {
    const deposit = await this.prisma.mobileDeposit.findFirst({
      where: { id: depositId, organizationId },
      include: {
        bankAccount: true,
      },
    });

    if (!deposit) {
      throw new NotFoundException('Mobile deposit not found');
    }

    return deposit;
  }

  async reviewDeposit(
    organizationId: string,
    depositId: string,
    dto: ReviewDepositDto,
    userId: string,
  ) {
    const deposit = await this.getDeposit(organizationId, depositId);

    if (deposit.status !== 'PENDING') {
      throw new BadRequestException('Deposit has already been reviewed');
    }

    if (dto.action === 'APPROVE') {
      const finalAmount = dto.adjustedAmount || Number(deposit.checkAmount);

      await this.prisma.mobileDeposit.update({
        where: { id: depositId },
        data: {
          status: 'APPROVED',
          checkAmount: new Prisma.Decimal(finalAmount),
          reviewedBy: userId,
          reviewedAt: new Date(),
          availableAt: this.calculateAvailabilityDate(finalAmount),
        },
      });

      // Create pending bank transaction
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: deposit.bankAccountId,
          transactionDate: new Date(),
          description: `Mobile Deposit - Check ${deposit.checkNumber || deposit.referenceNumber}`,
          amount: new Prisma.Decimal(finalAmount),
          transactionType: 'DEPOSIT',
          status: 'PENDING',
          category: 'DEPOSIT',
          referenceNumber: deposit.referenceNumber,
        },
      });

      this.logger.log(`Mobile deposit ${deposit.referenceNumber} approved`);

      return { success: true, status: 'APPROVED', amount: finalAmount };
    } else {
      await this.prisma.mobileDeposit.update({
        where: { id: depositId },
        data: {
          status: 'REJECTED',
          rejectionReason: dto.reason,
          reviewedBy: userId,
          reviewedAt: new Date(),
        },
      });

      this.logger.log(`Mobile deposit ${deposit.referenceNumber} rejected: ${dto.reason}`);

      return { success: true, status: 'REJECTED', reason: dto.reason };
    }
  }

  async clearDeposit(organizationId: string, depositId: string) {
    const deposit = await this.getDeposit(organizationId, depositId);

    if (deposit.status !== 'APPROVED') {
      throw new BadRequestException('Deposit must be approved before clearing');
    }

    await this.prisma.mobileDeposit.update({
      where: { id: depositId },
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
      },
    });

    // Update bank transaction to cleared
    await this.prisma.bankTransaction.updateMany({
      where: { referenceNumber: deposit.referenceNumber },
      data: { status: 'CLEARED' },
    });

    // Update bank account balance
    await this.prisma.bankAccount.update({
      where: { id: deposit.bankAccountId },
      data: {
        currentBalance: { increment: Number(deposit.checkAmount) },
      },
    });

    this.logger.log(`Mobile deposit ${deposit.referenceNumber} cleared`);

    return { success: true, status: 'CLEARED' };
  }

  async returnDeposit(
    organizationId: string,
    depositId: string,
    returnCode: string,
    returnReason: string,
  ) {
    const deposit = await this.getDeposit(organizationId, depositId);

    if (!['APPROVED', 'CLEARED'].includes(deposit.status)) {
      throw new BadRequestException('Cannot return deposit in current status');
    }

    await this.prisma.mobileDeposit.update({
      where: { id: depositId },
      data: {
        status: 'RETURNED',
        returnCode,
        returnReason,
      },
    });

    // If already cleared, reverse the transaction
    if (deposit.status === 'CLEARED') {
      await this.prisma.bankAccount.update({
        where: { id: deposit.bankAccountId },
        data: {
          currentBalance: { decrement: Number(deposit.checkAmount) },
        },
      });

      // Create reversal transaction
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: deposit.bankAccountId,
          transactionDate: new Date(),
          description: `Returned Deposit - ${returnReason}`,
          amount: new Prisma.Decimal(-Number(deposit.checkAmount)),
          transactionType: 'ADJUSTMENT',
          status: 'CLEARED',
          category: 'RETURNED_DEPOSIT',
          referenceNumber: `${deposit.referenceNumber}-RTN`,
        },
      });
    }

    this.logger.log(
      `Mobile deposit ${deposit.referenceNumber} returned: ${returnCode} - ${returnReason}`,
    );

    return { success: true, status: 'RETURNED', returnCode, returnReason };
  }

  // Deposit Statistics
  async getDepositStats(organizationId: string, bankAccountId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const where: Prisma.MobileDepositWhereInput = {
      organizationId,
      ...(bankAccountId && { bankAccountId }),
    };

    const [
      todayStats,
      monthStats,
      pendingCount,
      returnedCount,
    ] = await Promise.all([
      // Today's deposits
      this.prisma.mobileDeposit.aggregate({
        where: {
          ...where,
          uploadedAt: { gte: today },
          status: { in: ['PENDING', 'APPROVED', 'CLEARED'] },
        },
        _sum: { checkAmount: true },
        _count: true,
      }),
      // This month's deposits
      this.prisma.mobileDeposit.aggregate({
        where: {
          ...where,
          uploadedAt: { gte: thisMonth },
          status: { in: ['APPROVED', 'CLEARED'] },
        },
        _sum: { checkAmount: true },
        _count: true,
      }),
      // Pending review
      this.prisma.mobileDeposit.count({
        where: { ...where, status: 'PENDING' },
      }),
      // Returned this month
      this.prisma.mobileDeposit.count({
        where: { ...where, status: 'RETURNED', uploadedAt: { gte: thisMonth } },
      }),
    ]);

    // Get tier limits
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const tier = (organization?.subscriptionTier as keyof typeof this.DAILY_LIMITS) || 'STANDARD';

    return {
      today: {
        count: todayStats._count,
        amount: Number(todayStats._sum.checkAmount || 0),
        remainingLimit: this.DAILY_LIMITS[tier] - Number(todayStats._sum.checkAmount || 0),
      },
      thisMonth: {
        count: monthStats._count,
        amount: Number(monthStats._sum.checkAmount || 0),
      },
      pendingReview: pendingCount,
      returnedThisMonth: returnedCount,
      limits: {
        dailyLimit: this.DAILY_LIMITS[tier],
        perCheckLimit: this.CHECK_LIMITS[tier],
        tier,
      },
    };
  }

  // Duplicate Detection
  async checkForDuplicates(
    organizationId: string,
    amount: number,
    checkNumber?: string,
    micr?: string,
  ) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const potentialDuplicates = await this.prisma.mobileDeposit.findMany({
      where: {
        organizationId,
        uploadedAt: { gte: thirtyDaysAgo },
        status: { in: ['PENDING', 'APPROVED', 'CLEARED'] },
        OR: [
          // Same check number and amount
          checkNumber
            ? { checkNumber, checkAmount: new Prisma.Decimal(amount) }
            : { id: 'impossible' },
          // Same MICR
          micr ? { micr } : { id: 'impossible' },
          // Same amount within tolerance (for potential re-submission)
          {
            checkAmount: {
              gte: new Prisma.Decimal(amount * 0.99),
              lte: new Prisma.Decimal(amount * 1.01),
            },
          },
        ],
      },
      select: {
        id: true,
        referenceNumber: true,
        checkAmount: true,
        checkNumber: true,
        uploadedAt: true,
        status: true,
      },
    });

    return {
      hasPotentialDuplicates: potentialDuplicates.length > 0,
      potentialDuplicates,
    };
  }

  // Helper Methods
  private validateCheckImages(frontImage: string, backImage: string): void {
    // Validate base64 format
    const base64Regex = /^data:image\/(png|jpeg|jpg);base64,/;

    if (!base64Regex.test(frontImage)) {
      throw new BadRequestException('Invalid front check image format');
    }

    if (!base64Regex.test(backImage)) {
      throw new BadRequestException('Invalid back check image format');
    }

    // Check minimum image size (roughly estimate from base64 length)
    const minSize = 10000; // ~10KB minimum
    if (frontImage.length < minSize || backImage.length < minSize) {
      throw new BadRequestException('Check images must be at least 10KB');
    }
  }

  private async processCheckImages(
    frontImage: string,
    backImage: string,
  ): Promise<{
    checkNumber?: string;
    payerName?: string;
    micr?: string;
    routingNumber?: string;
    accountNumber?: string;
    confidence: number;
  }> {
    // In production, this would use OCR/ICR services like:
    // - AWS Textract
    // - Google Cloud Vision
    // - ABBYY FlexiCapture
    // - Mitek

    // For now, return simulated extracted data
    return {
      checkNumber: Math.floor(Math.random() * 9000 + 1000).toString(),
      payerName: 'Check Payer',
      micr: '⑆123456789⑆ 123456789⑈ 1234',
      routingNumber: '123456789',
      accountNumber: '123456789',
      confidence: 0.95,
    };
  }

  private async storeImage(
    base64Image: string,
    side: 'front' | 'back',
    referenceNumber: string,
  ): Promise<string> {
    // In production, store to S3, Azure Blob, or similar
    // Return URL to stored image
    return `/deposits/${referenceNumber}/${side}.jpg`;
  }

  private async generateReferenceNumber(organizationId: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

    const lastDeposit = await this.prisma.mobileDeposit.findFirst({
      where: {
        organizationId,
        referenceNumber: { startsWith: `MD${dateStr}` },
      },
      orderBy: { referenceNumber: 'desc' },
    });

    let sequence = 1;
    if (lastDeposit) {
      const lastSeq = parseInt((lastDeposit.referenceNumber ?? '').slice(-4), 10);
      sequence = lastSeq + 1;
    }

    return `MD${dateStr}${sequence.toString().padStart(4, '0')}`;
  }

  private calculateAvailabilityDate(amount: number): Date {
    const availableAt = new Date();

    // Funds availability based on amount (Reg CC guidelines)
    if (amount <= 225) {
      // Next business day
      availableAt.setDate(availableAt.getDate() + 1);
    } else if (amount <= 5525) {
      // 2 business days
      availableAt.setDate(availableAt.getDate() + 2);
    } else {
      // Up to 5 business days for larger amounts
      availableAt.setDate(availableAt.getDate() + 5);
    }

    // Skip weekends
    while (availableAt.getDay() === 0 || availableAt.getDay() === 6) {
      availableAt.setDate(availableAt.getDate() + 1);
    }

    return availableAt;
  }
}
