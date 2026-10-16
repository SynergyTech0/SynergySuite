import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, IsIn, IsBoolean, IsArray, ArrayMinSize, ValidateNested, IsPositive, IsDate } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { encryptSecret, decryptSecret } from '../../common/crypto.util';

export class AddEmployeeBankAccountDto {
  @IsString()
  employeeId: string;

  @IsIn(['CHECKING', 'SAVINGS'])
  accountType: 'CHECKING' | 'SAVINGS';

  @IsString()
  routingNumber: string;

  @IsString()
  accountNumber: string;

  @IsString()
  bankName: string;

  @IsString()
  accountHolderName: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsNumber()
  @IsOptional()
  allocationPercentage?: number;

  @IsNumber()
  @IsOptional()
  allocationAmount?: number;
}

export class AddVendorBankAccountDto {
  @IsString()
  vendorId: string;

  @IsIn(['CHECKING', 'SAVINGS'])
  accountType: 'CHECKING' | 'SAVINGS';

  @IsString()
  routingNumber: string;

  @IsString()
  accountNumber: string;

  @IsString()
  bankName: string;

  @IsString()
  accountHolderName: string;
}

export class ACHTransactionDto {
  @IsIn(['EMPLOYEE', 'VENDOR', 'CUSTOMER'])
  recipientType: 'EMPLOYEE' | 'VENDOR' | 'CUSTOMER';

  @IsString()
  recipientId: string;

  @IsString()
  recipientBankAccountId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsIn(['CREDIT', 'DEBIT'])
  transactionType: 'CREDIT' | 'DEBIT';

  @IsString()
  @IsOptional()
  addendaRecord?: string;

  @IsString()
  @IsOptional()
  referenceId?: string;
}

export class CreateACHBatchDto {
  @IsString()
  bankAccountId: string;

  @IsIn(['PAYROLL', 'VENDOR_PAYMENT', 'REFUND', 'COLLECTION'])
  batchType: 'PAYROLL' | 'VENDOR_PAYMENT' | 'REFUND' | 'COLLECTION';

  @IsDate()
  @Type(() => Date)
  effectiveDate: Date;

  @IsString()
  companyName: string;

  @IsString()
  companyId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ACHTransactionDto)
  transactions: ACHTransactionDto[];
}

@Injectable()
export class ACHProcessingService {
  private readonly logger = new Logger(ACHProcessingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Employee Bank Account Management
  async addEmployeeBankAccount(organizationId: string, dto: AddEmployeeBankAccountDto) {
    // Verify employee exists
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Validate routing number (ABA routing number is 9 digits)
    if (!/^\d{9}$/.test(dto.routingNumber)) {
      throw new BadRequestException('Invalid routing number. Must be 9 digits.');
    }

    // If setting as default, unset any existing default
    if (dto.isDefault) {
      await this.prisma.employeeBankAccount.updateMany({
        where: { employeeId: dto.employeeId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    // Mask account number for storage display
    const maskedAccountNumber = '****' + dto.accountNumber.slice(-4);

    const bankAccount = await this.prisma.employeeBankAccount.create({
      data: {
        employeeId: dto.employeeId,
        accountType: dto.accountType,
        routingNumber: dto.routingNumber,
        accountNumber: this.encryptAccountNumber(dto.accountNumber),
        accountLast4: maskedAccountNumber,
        bankName: dto.bankName,
        nameOnAccount: dto.accountHolderName,
        isPrimary: dto.isDefault ?? false,
        depositPercent: dto.allocationPercentage
          ? new Prisma.Decimal(dto.allocationPercentage)
          : null,
        depositAmount: dto.allocationAmount
          ? new Prisma.Decimal(dto.allocationAmount)
          : null,
        status: 'PENDING_VERIFICATION',
      },
    });

    this.logger.log(`Bank account added for employee ${dto.employeeId}`);

    return {
      id: bankAccount.id,
      accountType: bankAccount.accountType,
      bankName: bankAccount.bankName,
      accountNumberMasked: bankAccount.accountLast4,
      isDefault: bankAccount.isPrimary,
      status: bankAccount.status,
    };
  }

  async getEmployeeBankAccounts(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.prisma.employeeBankAccount.findMany({
      where: { employeeId },
      select: {
        id: true,
        accountType: true,
        routingNumber: true,
        accountLast4: true,
        bankName: true,
        nameOnAccount: true,
        isPrimary: true,
        depositPercent: true,
        depositAmount: true,
        status: true,
        verifiedAt: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async verifyEmployeeBankAccount(
    organizationId: string,
    employeeId: string,
    bankAccountId: string,
    microDeposits: { amount1: number; amount2: number },
  ) {
    const bankAccount = await this.prisma.employeeBankAccount.findFirst({
      where: { id: bankAccountId, employeeId },
      include: { employee: true },
    });

    if (!bankAccount || bankAccount.employee.organizationId !== organizationId) {
      throw new NotFoundException('Bank account not found');
    }

    // In production, verify against actual micro-deposit amounts
    // For now, simulate verification
    const isVerified = microDeposits.amount1 > 0 && microDeposits.amount2 > 0;

    if (!isVerified) {
      throw new BadRequestException('Micro-deposit amounts do not match');
    }

    await this.prisma.employeeBankAccount.update({
      where: { id: bankAccountId },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });

    this.logger.log(`Bank account ${bankAccountId} verified for employee ${employeeId}`);

    return { success: true, status: 'VERIFIED' };
  }

  // Vendor Bank Account Management
  async addVendorBankAccount(organizationId: string, dto: AddVendorBankAccountDto) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: dto.vendorId, organizationId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (!/^\d{9}$/.test(dto.routingNumber)) {
      throw new BadRequestException('Invalid routing number. Must be 9 digits.');
    }

    const maskedAccountNumber = '****' + dto.accountNumber.slice(-4);

    const bankAccount = await this.prisma.vendorBankAccount.create({
      data: {
        vendorId: dto.vendorId,
        accountType: dto.accountType,
        routingNumber: dto.routingNumber,
        accountNumber: this.encryptAccountNumber(dto.accountNumber),
        accountLast4: maskedAccountNumber,
        bankName: dto.bankName,
        nameOnAccount: dto.accountHolderName,
        status: 'ACTIVE',
      },
    });

    this.logger.log(`Bank account added for vendor ${dto.vendorId}`);

    return {
      id: bankAccount.id,
      accountType: bankAccount.accountType,
      bankName: bankAccount.bankName,
      accountNumberMasked: bankAccount.accountLast4,
      status: bankAccount.status,
    };
  }

  // List every vendor bank account in the org (recipients for ACH batches).
  async getVendorBankAccounts(organizationId: string) {
    const accounts = await this.prisma.vendorBankAccount.findMany({
      where: { isActive: true, vendor: { organizationId } },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return accounts.map((a) => ({
      id: a.id,
      vendorId: a.vendorId,
      vendorName: a.vendor?.name ?? '—',
      bankName: a.bankName,
      accountType: a.accountType,
      accountLast4: a.accountLast4,
      nameOnAccount: a.nameOnAccount,
    }));
  }

  // ACH Batch Processing
  async createACHBatch(organizationId: string, dto: CreateACHBatchDto, userId: string) {
    // Verify source bank account
    const sourceAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });

    if (!sourceAccount) {
      throw new NotFoundException('Source bank account not found');
    }

    // Calculate totals
    const totalCredits = dto.transactions
      .filter((t) => t.transactionType === 'CREDIT')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalDebits = dto.transactions
      .filter((t) => t.transactionType === 'DEBIT')
      .reduce((sum, t) => sum + t.amount, 0);

    // Generate batch number
    const batchNumber = await this.generateBatchNumber(organizationId);

    // Create ACH batch
    const batch = await this.prisma.aCHBatch.create({
      data: {
        organizationId,
        bankAccountId: dto.bankAccountId,
        batchNumber,
        batchType: dto.batchType,
        effectiveDate: dto.effectiveDate,
        companyName: dto.companyName,
        companyId: dto.companyId,
        totalCredits: new Prisma.Decimal(totalCredits),
        totalDebits: new Prisma.Decimal(totalDebits),
        transactionCount: dto.transactions.length,
        status: 'PENDING',
        createdBy: userId,
      },
    });

    // Create individual transactions
    const transactions = await Promise.all(
      dto.transactions.map(async (txn, index) => {
        // Get recipient bank account details
        let recipientAccount: any;
        if (txn.recipientType === 'EMPLOYEE') {
          recipientAccount = await this.prisma.employeeBankAccount.findUnique({
            where: { id: txn.recipientBankAccountId },
          });
        } else if (txn.recipientType === 'VENDOR') {
          recipientAccount = await this.prisma.vendorBankAccount.findUnique({
            where: { id: txn.recipientBankAccountId },
          });
        }

        if (!recipientAccount) {
          throw new BadRequestException(
            `Recipient bank account not found for transaction ${index + 1}`,
          );
        }

        // Generate trace number
        const traceNumber = this.generateTraceNumber(sourceAccount.routingNumber || '', index);

        return this.prisma.aCHTransaction.create({
          data: {
            batchId: batch.id,
            traceNumber,
            transactionType: txn.transactionType,
            amount: new Prisma.Decimal(txn.amount),
            receiverType: txn.recipientType,
            receiverId: txn.recipientId,
            receiverName: recipientAccount.nameOnAccount,
            routingNumber: recipientAccount.routingNumber,
            accountNumber: this.decryptAccountNumber(
              recipientAccount.accountNumber,
            ),
            accountType: recipientAccount.accountType,
            addendaRecord: txn.addendaRecord,
            individualId: txn.referenceId,
            status: 'PENDING',
          },
        });
      }),
    );

    this.logger.log(
      `ACH batch ${batchNumber} created with ${transactions.length} transactions`,
    );

    return {
      batch,
      transactions: transactions.map((t) => ({
        id: t.id,
        traceNumber: t.traceNumber,
        amount: t.amount,
        recipientName: t.receiverName,
        status: t.status,
      })),
    };
  }

  async generateNACHAFile(organizationId: string, batchId: string) {
    const batch = await this.prisma.aCHBatch.findFirst({
      where: { id: batchId, organizationId },
      include: {
        bankAccount: true,
        transactions: true,
      },
    });

    if (!batch) {
      throw new NotFoundException('ACH batch not found');
    }

    if (batch.status !== 'PENDING') {
      throw new BadRequestException('Batch has already been processed');
    }

    const nachaContent = this.buildNACHAFile(batch);

    // Update batch status
    await this.prisma.aCHBatch.update({
      where: { id: batchId },
      data: {
        status: 'GENERATED',
        nachaFileContent: nachaContent,
        generatedAt: new Date(),
      },
    });

    this.logger.log(`NACHA file generated for batch ${batch.batchNumber}`);

    return {
      batchNumber: batch.batchNumber,
      fileName: `ACH_${batch.batchNumber}_${this.formatDate(new Date())}.txt`,
      content: nachaContent,
      transactionCount: batch.transactionCount,
      totalAmount: Number(batch.totalCredits) + Number(batch.totalDebits),
    };
  }

  async submitACHBatch(organizationId: string, batchId: string) {
    const batch = await this.prisma.aCHBatch.findFirst({
      where: { id: batchId, organizationId },
    });

    if (!batch) {
      throw new NotFoundException('ACH batch not found');
    }

    if (batch.status !== 'GENERATED') {
      throw new BadRequestException('NACHA file must be generated first');
    }

    // In production, this would submit to the bank's ACH processor
    // For now, simulate submission

    await this.prisma.aCHBatch.update({
      where: { id: batchId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    // Update all transactions
    await this.prisma.aCHTransaction.updateMany({
      where: { batchId },
      data: { status: 'SUBMITTED' },
    });

    this.logger.log(`ACH batch ${batch.batchNumber} submitted to processor`);

    return { success: true, status: 'SUBMITTED', batchNumber: batch.batchNumber };
  }

  async getACHBatches(
    organizationId: string,
    options?: {
      batchType?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.ACHBatchWhereInput = {
      organizationId,
      ...(options?.batchType && { batchType: options.batchType as any }),
      ...(options?.status && { status: options.status as any }),
      ...(options?.startDate || options?.endDate
        ? {
            effectiveDate: {
              ...(options?.startDate && { gte: options.startDate }),
              ...(options?.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const [batches, total] = await Promise.all([
      this.prisma.aCHBatch.findMany({
        where,
        include: {
          bankAccount: { select: { accountName: true, accountNumber: true } },
          _count: { select: { transactions: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.aCHBatch.count({ where }),
    ]);

    return { batches, total };
  }

  async getACHBatchDetails(organizationId: string, batchId: string) {
    const batch = await this.prisma.aCHBatch.findFirst({
      where: { id: batchId, organizationId },
      include: {
        bankAccount: true,
        transactions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('ACH batch not found');
    }

    // Mask account numbers in response
    const maskedTransactions = batch.transactions.map((t) => ({
      ...t,
      recipientAccountNumber: '****' + (t.accountNumber?.slice(-4) ?? ''),
    }));

    return {
      ...batch,
      transactions: maskedTransactions,
    };
  }

  // Payroll Direct Deposit Helper
  async createPayrollDirectDeposit(
    organizationId: string,
    payrollRunId: string,
    effectiveDate: Date,
    userId: string,
  ) {
    // Get payroll run with employee payments
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: { id: payrollRunId, organizationId },
      include: {
        paychecks: {
          include: {
            employee: {
              include: {
                EmployeeBankAccount: {
                  where: { status: 'VERIFIED', isPrimary: true },
                },
              },
            },
          },
        },
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    // Get organization's primary bank account
    const primaryBankAccount = await this.prisma.bankAccount.findFirst({
      where: { organizationId, isPrimary: true },
    });

    if (!primaryBankAccount) {
      throw new BadRequestException('No primary bank account configured');
    }

    // Get organization for company details
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    // Build transactions for employees with direct deposit
    const transactions: CreateACHBatchDto['transactions'] = [];
    for (const item of payrollRun.paychecks) {
      if (item.employee.EmployeeBankAccount.length > 0) {
        const bankAccount = item.employee.EmployeeBankAccount[0];
        transactions.push({
          recipientType: 'EMPLOYEE' as const,
          recipientId: item.employeeId,
          recipientBankAccountId: bankAccount.id,
          amount: Number(item.netPay),
          transactionType: 'CREDIT' as const,
          addendaRecord: `PAYROLL ${payrollRun.periodEnd.toISOString().split('T')[0]}`,
          referenceId: item.id,
        });
      }
    }

    if (transactions.length === 0) {
      throw new BadRequestException('No employees configured for direct deposit');
    }

    return this.createACHBatch(
      organizationId,
      {
        bankAccountId: primaryBankAccount.id,
        batchType: 'PAYROLL',
        effectiveDate,
        companyName: organization?.name || 'Company',
        companyId: organization?.taxId || organizationId.slice(0, 10),
        transactions,
      },
      userId,
    );
  }

  // Helper Methods
  private encryptAccountNumber(accountNumber: string): string {
    return encryptSecret(accountNumber);
  }

  private decryptAccountNumber(encrypted: string): string {
    return decryptSecret(encrypted);
  }

  private async generateBatchNumber(organizationId: string): Promise<string> {
    const today = new Date();
    const datePrefix = today.toISOString().slice(0, 10).replace(/-/g, '');

    const lastBatch = await this.prisma.aCHBatch.findFirst({
      where: {
        organizationId,
        batchNumber: { startsWith: `ACH${datePrefix}` },
      },
      orderBy: { batchNumber: 'desc' },
    });

    let sequence = 1;
    if (lastBatch) {
      const lastSeq = parseInt(lastBatch.batchNumber.slice(-4), 10);
      sequence = lastSeq + 1;
    }

    return `ACH${datePrefix}${sequence.toString().padStart(4, '0')}`;
  }

  private generateTraceNumber(routingNumber: string, index: number): string {
    const date = new Date();
    const dayOfYear = Math.floor(
      (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000,
    );
    return `${routingNumber.slice(0, 8)}${dayOfYear.toString().padStart(3, '0')}${index.toString().padStart(4, '0')}`;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private buildNACHAFile(batch: any): string {
    const lines: string[] = [];
    const now = new Date();

    // File Header Record (Type 1)
    lines.push(this.buildFileHeader(batch, now));

    // Batch Header Record (Type 5)
    lines.push(this.buildBatchHeader(batch));

    // Entry Detail Records (Type 6) and Addenda (Type 7)
    let entryHash = 0;
    for (const txn of batch.transactions) {
      lines.push(this.buildEntryDetail(txn, batch));
      entryHash += parseInt(txn.recipientRoutingNumber.slice(0, 8), 10);

      if (txn.addendaRecord) {
        lines.push(this.buildAddenda(txn));
      }
    }

    // Batch Control Record (Type 8)
    lines.push(this.buildBatchControl(batch, entryHash));

    // File Control Record (Type 9)
    lines.push(this.buildFileControl(batch, entryHash));

    // Pad to block of 10 lines
    while (lines.length % 10 !== 0) {
      lines.push('9'.repeat(94));
    }

    return lines.join('\n');
  }

  private buildFileHeader(batch: any, date: Date): string {
    const recordType = '1';
    const priorityCode = '01';
    const immediateDestination = ' ' + batch.bankAccount.routingNumber;
    const immediateOrigin = ' ' + batch.companyId.padEnd(10, ' ').slice(0, 10);
    const fileCreationDate = this.formatNACHADate(date);
    const fileCreationTime = this.formatNACHATime(date);
    const fileIdModifier = 'A';
    const recordSize = '094';
    const blockingFactor = '10';
    const formatCode = '1';
    const destName = 'DEST BANK'.padEnd(23, ' ');
    const originName = batch.companyName.padEnd(23, ' ').slice(0, 23);
    const referenceCode = ''.padEnd(8, ' ');

    return `${recordType}${priorityCode}${immediateDestination}${immediateOrigin}${fileCreationDate}${fileCreationTime}${fileIdModifier}${recordSize}${blockingFactor}${formatCode}${destName}${originName}${referenceCode}`;
  }

  private buildBatchHeader(batch: any): string {
    const recordType = '5';
    const serviceClass = batch.batchType === 'PAYROLL' ? '220' : '200';
    const companyName = batch.companyName.padEnd(16, ' ').slice(0, 16);
    const discretionaryData = ''.padEnd(20, ' ');
    const companyId = batch.companyId.padEnd(10, ' ').slice(0, 10);
    const secCode = batch.batchType === 'PAYROLL' ? 'PPD' : 'CCD';
    const entryDesc = 'PAYMENT'.padEnd(10, ' ');
    const compDescDate = ''.padEnd(6, ' ');
    const effectiveDate = this.formatNACHADate(batch.effectiveDate);
    const settlementDate = '   ';
    const originatorStatus = '1';
    const originDfi = batch.bankAccount.routingNumber.slice(0, 8);
    const batchNumber = '0000001';

    return `${recordType}${serviceClass}${companyName}${discretionaryData}${companyId}${secCode}${entryDesc}${compDescDate}${effectiveDate}${settlementDate}${originatorStatus}${originDfi}${batchNumber}`;
  }

  private buildEntryDetail(txn: any, batch: any): string {
    const recordType = '6';
    const transactionCode = txn.transactionType === 'CREDIT'
      ? (txn.recipientAccountType === 'CHECKING' ? '22' : '32')
      : (txn.recipientAccountType === 'CHECKING' ? '27' : '37');
    const rdfi = txn.recipientRoutingNumber.slice(0, 8);
    const checkDigit = txn.recipientRoutingNumber.slice(8, 9);
    const dfiAccount = txn.recipientAccountNumber.padEnd(17, ' ').slice(0, 17);
    const amount = Math.round(Number(txn.amount) * 100).toString().padStart(10, '0');
    const idNumber = (txn.individualId || txn.id).slice(0, 15).padEnd(15, ' ');
    const receiverName = txn.recipientName.padEnd(22, ' ').slice(0, 22);
    const discretionaryData = '  ';
    const addendaIndicator = txn.addendaRecord ? '1' : '0';
    const traceNumber = txn.traceNumber;

    return `${recordType}${transactionCode}${rdfi}${checkDigit}${dfiAccount}${amount}${idNumber}${receiverName}${discretionaryData}${addendaIndicator}${traceNumber}`;
  }

  private buildAddenda(txn: any): string {
    const recordType = '7';
    const addendaTypeCode = '05';
    const paymentInfo = (txn.addendaRecord || '').padEnd(80, ' ').slice(0, 80);
    const addendaSeq = '0001';
    const entrySeq = txn.traceNumber.slice(-7);

    return `${recordType}${addendaTypeCode}${paymentInfo}${addendaSeq}${entrySeq}`;
  }

  private buildBatchControl(batch: any, entryHash: number): string {
    const recordType = '8';
    const serviceClass = batch.batchType === 'PAYROLL' ? '220' : '200';
    const entryCount = batch.transactions.length.toString().padStart(6, '0');
    const hashTotal = (entryHash % 10000000000).toString().padStart(10, '0');
    const totalDebit = Math.round(Number(batch.totalDebits) * 100).toString().padStart(12, '0');
    const totalCredit = Math.round(Number(batch.totalCredits) * 100).toString().padStart(12, '0');
    const companyId = batch.companyId.padEnd(10, ' ').slice(0, 10);
    const messageAuth = ''.padEnd(19, ' ');
    const reserved = ''.padEnd(6, ' ');
    const originDfi = batch.bankAccount.routingNumber.slice(0, 8);
    const batchNumber = '0000001';

    return `${recordType}${serviceClass}${entryCount}${hashTotal}${totalDebit}${totalCredit}${companyId}${messageAuth}${reserved}${originDfi}${batchNumber}`;
  }

  private buildFileControl(batch: any, entryHash: number): string {
    const recordType = '9';
    const batchCount = '000001';
    const blockCount = Math.ceil((batch.transactions.length + 4) / 10).toString().padStart(6, '0');
    const entryCount = batch.transactions.length.toString().padStart(8, '0');
    const hashTotal = (entryHash % 10000000000).toString().padStart(10, '0');
    const totalDebit = Math.round(Number(batch.totalDebits) * 100).toString().padStart(12, '0');
    const totalCredit = Math.round(Number(batch.totalCredits) * 100).toString().padStart(12, '0');
    const reserved = ''.padEnd(39, ' ');

    return `${recordType}${batchCount}${blockCount}${entryCount}${hashTotal}${totalDebit}${totalCredit}${reserved}`;
  }

  private formatNACHADate(date: Date): string {
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private formatNACHATime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}${minutes}`;
  }
}
