import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class Form1099Service {
  private readonly logger = new Logger(Form1099Service.name);

  constructor(private readonly prisma: PrismaService) {}

  async getEligibleVendors(organizationId: string, taxYear: number) {
    const startOfYear = new Date(taxYear, 0, 1);
    const endOfYear = new Date(taxYear, 11, 31, 23, 59, 59);

    const vendors = await this.prisma.vendor.findMany({
      where: { organizationId, requires1099: true },
      include: {
        bills: {
          where: { billDate: { gte: startOfYear, lte: endOfYear }, status: 'PAID' },
        },
      },
    });

    return vendors.map((vendor) => ({
      vendorId: vendor.id,
      vendorName: vendor.name,
      taxId: vendor.taxId,
      form1099Type: vendor.vendor1099Type || 'NEC',
      totalPayments: vendor.bills.reduce((sum, b) => sum + Number(b.totalAmount), 0),
      requiresForm: vendor.bills.reduce((sum, b) => sum + Number(b.totalAmount), 0) >= 600,
    })).filter((v) => v.requiresForm);
  }

  async generate1099(
    organizationId: string,
    vendorId: string,
    taxYear: number,
    formType: string = 'NEC',
  ) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, organizationId },
    });

    if (!vendor) throw new NotFoundException('Vendor not found');

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    const startOfYear = new Date(taxYear, 0, 1);
    const endOfYear = new Date(taxYear, 11, 31, 23, 59, 59);

    const bills = await this.prisma.bill.findMany({
      where: {
        vendorId,
        billDate: { gte: startOfYear, lte: endOfYear },
        status: 'PAID',
      },
    });

    const totalAmount = bills.reduce((sum, b) => sum + Number(b.totalAmount), 0);

    const form = await this.prisma.form1099.upsert({
      where: {
        organizationId_vendorId_taxYear_formType: {
          organizationId,
          vendorId,
          taxYear,
          formType: formType as any,
        },
      },
      update: {
        status: 'GENERATED',
        recipientName: vendor.name,
        recipientTin: vendor.taxId,
        recipientTinType: vendor.taxId?.length === 9 ? 'SSN' : 'EIN',
        recipientAddress: vendor.address || {},
        totalAmount: new Prisma.Decimal(totalAmount),
        generatedAt: new Date(),
      },
      create: {
        organizationId,
        vendorId,
        taxYear,
        formType: formType as any,
        status: 'GENERATED',
        recipientName: vendor.name,
        recipientTin: vendor.taxId,
        recipientTinType: vendor.taxId?.length === 9 ? 'SSN' : 'EIN',
        recipientAddress: vendor.address || {},
        payerName: organization?.name || '',
        payerTin: organization?.taxId || '',
        payerAddress: organization?.address || {},
        totalAmount: new Prisma.Decimal(totalAmount),
        generatedAt: new Date(),
      },
    });

    // Create line items based on form type
    if (formType === 'NEC') {
      await this.prisma.form1099Line.upsert({
        where: { form1099Id_boxNumber: { form1099Id: form.id, boxNumber: '1' } },
        update: { amount: new Prisma.Decimal(totalAmount) },
        create: {
          form1099Id: form.id,
          boxNumber: '1',
          boxLabel: 'Nonemployee compensation',
          amount: new Prisma.Decimal(totalAmount),
        },
      });
    }

    return this.prisma.form1099.findUnique({
      where: { id: form.id },
      include: { lines: true, vendor: { select: { name: true, email: true } } },
    });
  }

  async batchGenerate(organizationId: string, taxYear: number) {
    const eligibleVendors = await this.getEligibleVendors(organizationId, taxYear);
    const results = [];

    for (const vendor of eligibleVendors) {
      try {
        const form = await this.generate1099(organizationId, vendor.vendorId, taxYear, vendor.form1099Type);
        results.push({ vendorId: vendor.vendorId, success: true, formId: form?.id });
      } catch (error) {
        results.push({ vendorId: vendor.vendorId, success: false, error: (error as Error).message });
      }
    }

    return { generated: results.filter((r) => r.success).length, results };
  }

  async get1099s(organizationId: string, taxYear: number, status?: string) {
    return this.prisma.form1099.findMany({
      where: {
        organizationId,
        taxYear,
        ...(status && { status: status as any }),
      },
      include: {
        vendor: { select: { name: true, email: true } },
        lines: true,
      },
      orderBy: { recipientName: 'asc' },
    });
  }

  async get1099(organizationId: string, formId: string) {
    const form = await this.prisma.form1099.findFirst({
      where: { id: formId, organizationId },
      include: { vendor: true, lines: true, filings: true },
    });

    if (!form) throw new NotFoundException('Form 1099 not found');
    return form;
  }

  async sendToRecipient(organizationId: string, formId: string, method: 'EMAIL' | 'MAIL' | 'PORTAL') {
    const form = await this.get1099(organizationId, formId);

    if (form.status === 'DRAFT') {
      throw new BadRequestException('Form must be generated before sending');
    }

    await this.prisma.form1099Filing.create({
      data: {
        form1099Id: formId,
        filingType: 'RECIPIENT',
        method,
        filedAt: new Date(),
        filedBy: 'system',
      },
    });

    await this.prisma.form1099.update({
      where: { id: formId },
      data: {
        status: 'SENT_TO_RECIPIENT',
        sentToRecipientAt: new Date(),
      },
    });

    return { success: true, method };
  }

  async fileWithIRS(organizationId: string, formId: string) {
    const form = await this.get1099(organizationId, formId);

    if (!['GENERATED', 'REVIEWED', 'SENT_TO_RECIPIENT'].includes(form.status)) {
      throw new BadRequestException('Form not ready for IRS filing');
    }

    // Mock IRS e-filing - in production, integrate with IRS FIRE system
    const submissionId = `FIRE-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    await this.prisma.form1099Filing.create({
      data: {
        form1099Id: formId,
        filingType: 'IRS',
        method: 'EFILE',
        filedAt: new Date(),
        filedBy: 'system',
        transmissionId: submissionId,
        transmissionStatus: 'SUBMITTED',
      },
    });

    await this.prisma.form1099.update({
      where: { id: formId },
      data: {
        status: 'FILED_WITH_IRS',
        filedWithIrsAt: new Date(),
        irsSubmissionId: submissionId,
      },
    });

    return { success: true, submissionId };
  }

  async get1099Summary(organizationId: string, taxYear: number) {
    const forms = await this.prisma.form1099.findMany({
      where: { organizationId, taxYear },
    });

    return {
      taxYear,
      totalForms: forms.length,
      totalAmount: forms.reduce((sum, f) => sum + Number(f.totalAmount), 0),
      byStatus: {
        draft: forms.filter((f) => f.status === 'DRAFT').length,
        generated: forms.filter((f) => f.status === 'GENERATED').length,
        sentToRecipient: forms.filter((f) => f.status === 'SENT_TO_RECIPIENT').length,
        filedWithIrs: forms.filter((f) => f.status === 'FILED_WITH_IRS').length,
        accepted: forms.filter((f) => f.status === 'ACCEPTED').length,
      },
      byFormType: {
        NEC: forms.filter((f) => f.formType === 'NEC').length,
        MISC: forms.filter((f) => f.formType === 'MISC').length,
      },
    };
  }
}
