import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createTemplate(organizationId: string, data: {
    name: string;
    type: 'INVOICE' | 'BILL' | 'JOURNAL' | 'EXPENSE' | 'TRANSFER';
    templateData: any;
    customerId?: string;
    vendorId?: string;
    schedule: {
      frequency: string;
      interval?: number;
      dayOfWeek?: number;
      dayOfMonth?: number;
      startDate: Date;
      endDate?: Date;
      maxOccurrences?: number;
    };
    options?: {
      autoSend?: boolean;
      autoApprove?: boolean;
      autoPost?: boolean;
      notifyBeforeDays?: number;
    };
    createdBy: string;
  }) {
    const template = await this.prisma.recurringTemplate.create({
      data: {
        organizationId,
        name: data.name,
        type: data.type,
        status: 'ACTIVE',
        templateData: data.templateData,
        customerId: data.customerId,
        vendorId: data.vendorId,
        autoSend: data.options?.autoSend || false,
        autoApprove: data.options?.autoApprove || false,
        autoPost: data.options?.autoPost || false,
        notifyBeforeDays: data.options?.notifyBeforeDays,
        notifyOnCreation: true,
        createdBy: data.createdBy,
        schedule: {
          create: {
            frequency: data.schedule.frequency as any,
            interval: data.schedule.interval || 1,
            dayOfWeek: data.schedule.dayOfWeek,
            dayOfMonth: data.schedule.dayOfMonth,
            startDate: data.schedule.startDate,
            endDate: data.schedule.endDate,
            maxOccurrences: data.schedule.maxOccurrences,
            nextRunDate: this.calculateNextRunDate(data.schedule),
          },
        },
      },
      include: { schedule: true },
    });

    return template;
  }

  private calculateNextRunDate(schedule: any): Date {
    const now = new Date();
    let nextRun = new Date(schedule.startDate);

    if (nextRun <= now) {
      switch (schedule.frequency) {
        case 'DAILY':
          nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'WEEKLY':
          nextRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          if (schedule.dayOfWeek !== undefined) {
            while (nextRun.getDay() !== schedule.dayOfWeek) {
              nextRun.setDate(nextRun.getDate() + 1);
            }
          }
          break;
        case 'BIWEEKLY':
          nextRun = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
          break;
        case 'MONTHLY':
          nextRun = new Date(now.getFullYear(), now.getMonth() + 1, schedule.dayOfMonth || 1);
          break;
        case 'QUARTERLY':
          const quarterMonth = Math.floor(now.getMonth() / 3) * 3 + 3;
          nextRun = new Date(now.getFullYear(), quarterMonth, schedule.dayOfMonth || 1);
          break;
        case 'ANNUALLY':
          nextRun = new Date(now.getFullYear() + 1, schedule.monthOfYear || 0, schedule.dayOfMonth || 1);
          break;
      }
    }

    return nextRun;
  }

  async getTemplates(organizationId: string, options?: { type?: string; status?: string }) {
    return this.prisma.recurringTemplate.findMany({
      where: {
        organizationId,
        ...(options?.type && { type: options.type as any }),
        ...(options?.status && { status: options.status as any }),
      },
      include: {
        schedule: true,
        _count: { select: { transactions: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(organizationId: string, templateId: string) {
    const template = await this.prisma.recurringTemplate.findFirst({
      where: { id: templateId, organizationId },
      include: {
        schedule: true,
        transactions: { orderBy: { scheduledDate: 'desc' }, take: 10 },
      },
    });

    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async processScheduledTransactions() {
    const now = new Date();

    const dueSchedules = await this.prisma.recurringSchedule.findMany({
      where: {
        template: { status: 'ACTIVE' },
        nextRunDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      include: { template: true },
    });

    const results = [];

    for (const schedule of dueSchedules) {
      if (schedule.maxOccurrences && schedule.occurrenceCount >= schedule.maxOccurrences) {
        await this.prisma.recurringTemplate.update({
          where: { id: schedule.templateId },
          data: { status: 'COMPLETED' },
        });
        continue;
      }

      try {
        const result = await this.generateTransaction(schedule);
        results.push({ templateId: schedule.templateId, success: true, result });

        // Update schedule
        const nextRunDate = this.calculateNextRunDate({
          frequency: schedule.frequency,
          interval: schedule.interval,
          dayOfWeek: schedule.dayOfWeek,
          dayOfMonth: schedule.dayOfMonth,
          startDate: schedule.nextRunDate,
        });

        await this.prisma.recurringSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunDate: now,
            lastRunStatus: 'SUCCESS',
            nextRunDate,
            occurrenceCount: { increment: 1 },
          },
        });
      } catch (error) {
        this.logger.error(`Failed to process recurring template ${schedule.templateId}`, error);
        results.push({ templateId: schedule.templateId, success: false, error: (error as Error).message });

        await this.prisma.recurringSchedule.update({
          where: { id: schedule.id },
          data: { lastRunStatus: 'FAILED' },
        });
      }
    }

    return { processed: results.length, results };
  }

  private async generateTransaction(schedule: any) {
    const template = schedule.template;
    const templateData = template.templateData as any;

    // Create recurring transaction record
    const recurringTxn = await this.prisma.recurringTransaction.create({
      data: {
        templateId: template.id,
        scheduledDate: schedule.nextRunDate,
        status: 'SCHEDULED',
      },
    });

    try {
      let generatedEntityId: string | null = null;
      let generatedEntityType: string | null = null;

      // Generate the actual transaction based on type
      // In production, this would call the appropriate service
      switch (template.type) {
        case 'INVOICE':
          // Would call InvoiceService.create()
          generatedEntityType = 'Invoice';
          this.logger.log(`Would create invoice from template ${template.id}`);
          break;
        case 'BILL':
          // Would call BillService.create()
          generatedEntityType = 'Bill';
          this.logger.log(`Would create bill from template ${template.id}`);
          break;
        case 'JOURNAL':
          // Would call JournalService.create()
          generatedEntityType = 'Journal';
          this.logger.log(`Would create journal from template ${template.id}`);
          break;
        case 'EXPENSE':
          generatedEntityType = 'Expense';
          this.logger.log(`Would create expense from template ${template.id}`);
          break;
      }

      await this.prisma.recurringTransaction.update({
        where: { id: recurringTxn.id },
        data: {
          status: 'GENERATED',
          generatedEntityType,
          generatedEntityId,
          processedAt: new Date(),
          processedBy: 'SYSTEM',
        },
      });

      return { transactionId: recurringTxn.id, generatedEntityType, generatedEntityId };
    } catch (error) {
      await this.prisma.recurringTransaction.update({
        where: { id: recurringTxn.id },
        data: {
          status: 'FAILED',
          failureReason: (error as Error).message,
          retryCount: { increment: 1 },
        },
      });
      throw error;
    }
  }

  async pauseTemplate(organizationId: string, templateId: string) {
    const template = await this.getTemplate(organizationId, templateId);
    if (template.status !== 'ACTIVE') throw new BadRequestException('Template is not active');

    return this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { status: 'PAUSED' },
    });
  }

  async resumeTemplate(organizationId: string, templateId: string) {
    const template = await this.getTemplate(organizationId, templateId);
    if (template.status !== 'PAUSED') throw new BadRequestException('Template is not paused');

    return this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { status: 'ACTIVE' },
    });
  }

  async cancelTemplate(organizationId: string, templateId: string) {
    const template = await this.getTemplate(organizationId, templateId);

    return this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { status: 'CANCELLED' },
    });
  }

  async getUpcoming(organizationId: string, days: number = 30) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    return this.prisma.recurringSchedule.findMany({
      where: {
        template: { organizationId, status: 'ACTIVE' },
        nextRunDate: { lte: endDate },
      },
      include: {
        template: { select: { name: true, type: true } },
      },
      orderBy: { nextRunDate: 'asc' },
    });
  }
}
