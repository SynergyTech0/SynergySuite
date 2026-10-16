import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { v4 as uuidv4 } from 'uuid';

export class CreateTimesheetDto {
  employeeId: string;
  weekStartDate: Date;
  entries: TimesheetEntryDto[];
}

export class TimesheetEntryDto {
  date: Date;
  hours: number;
  taskId?: string;
  description?: string;
}

@Injectable()
export class TimesheetService {
  private readonly logger = new Logger(TimesheetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createTimesheet(organizationId: string, dto: CreateTimesheetDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee || employee.organizationId !== organizationId) {
      throw new NotFoundException('Employee not found');
    }

    const weekStart = new Date(dto.weekStartDate);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Check existing timesheet
    const existing = await this.prisma.timesheet.findUnique({
      where: {
        employeeId_weekStartDate: {
          employeeId: dto.employeeId,
          weekStartDate: weekStart,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('Timesheet already exists for this week');
    }

    let totalHours = new Decimal(0);
    const entries = dto.entries.map((entry) => {
      totalHours = totalHours.plus(new Decimal(entry.hours));
      return {
        date: new Date(entry.date),
        hours: entry.hours,
        taskId: entry.taskId,
        description: entry.description,
      };
    });

    const hourlyRate = employee.hourlyRate || new Decimal(0);
    const totalAmount = totalHours.times(hourlyRate);

    const timesheet = await this.prisma.timesheet.create({
      data: {
        id: uuidv4(),
        organizationId,
        employeeId: dto.employeeId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        totalHours: totalHours.toNumber(),
        totalAmount: totalAmount.toNumber(),
        entries: {
          createMany: {
            data: entries,
          },
        },
      },
      include: { entries: true, employee: true },
    });

    this.logger.log(`Timesheet created for employee ${employee.employeeId}`);
    return timesheet;
  }

  async getTimesheet(organizationId: string, timesheetId: string) {
    const timesheet = await this.prisma.timesheet.findUnique({
      where: { id: timesheetId },
      include: { entries: true, employee: true, auditTrail: true },
    });

    if (!timesheet || timesheet.organizationId !== organizationId) {
      throw new NotFoundException('Timesheet not found');
    }

    return timesheet;
  }

  async listTimesheets(organizationId: string, filters?: { employeeId?: string; status?: string }) {
    return this.prisma.timesheet.findMany({
      where: {
        organizationId,
        ...(filters?.employeeId && { employeeId: filters.employeeId }),
        ...(filters?.status && { status: filters.status as any }),
      },
      include: { employee: true },
      orderBy: { weekStartDate: 'desc' },
    });
  }

  async submitTimesheet(organizationId: string, timesheetId: string, userId: string) {
    const timesheet = await this.getTimesheet(organizationId, timesheetId);

    if (timesheet.status !== 'DRAFT') {
      throw new BadRequestException('Only draft timesheets can be submitted');
    }

    const updated = await this.prisma.timesheet.update({
      where: { id: timesheetId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedBy: userId,
      },
      include: { entries: true, employee: true },
    });

    await this.prisma.auditTrailEntry.create({
      data: {
        organizationId,
        actionType: 'SUBMIT',
        entityType: 'Timesheet',
        entityId: timesheetId,
        userId,
      },
    });

    return updated;
  }

  async approveTimesheet(organizationId: string, timesheetId: string, userId: string) {
    const timesheet = await this.getTimesheet(organizationId, timesheetId);

    if (timesheet.status !== 'SUBMITTED') {
      throw new BadRequestException('Only submitted timesheets can be approved');
    }

    const updated = await this.prisma.timesheet.update({
      where: { id: timesheetId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: userId,
      },
    });

    await this.prisma.auditTrailEntry.create({
      data: {
        organizationId,
        actionType: 'APPROVE',
        entityType: 'Timesheet',
        entityId: timesheetId,
        userId,
      },
    });

    return updated;
  }

  async getEmployeeHours(organizationId: string, employeeId: string, startDate: Date, endDate: Date) {
    const entries = await this.prisma.timesheetEntry.findMany({
      where: {
        timesheet: {
          organizationId,
          employeeId,
        },
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: { task: true, timesheet: true },
    });

    const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

    return {
      employeeId,
      startDate,
      endDate,
      entries,
      totalHours,
    };
  }
}
