import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createProject(organizationId: string, data: {
    name: string;
    projectNumber?: string;
    description?: string;
    customerId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    budgetedHours?: number;
    budgetedAmount?: number;
    // Schema-named aliases (the web app sends budgetAmount)
    budgetHours?: number;
    budgetAmount?: number;
    billingType?: string;
    billRate?: number;
    managerId?: string;
    notes?: string;
  }) {
    const projectNumber = data.projectNumber || await this.generateProjectNumber(organizationId);

    const budgetHours = data.budgetHours ?? data.budgetedHours;
    const budgetAmount = data.budgetAmount ?? data.budgetedAmount;

    return this.prisma.project.create({
      data: {
        organizationId,
        projectNumber,
        name: data.name,
        description: data.description,
        customerId: data.customerId,
        status: data.status as any || 'ACTIVE',
        startDate: data.startDate,
        endDate: data.endDate,
        budgetHours: budgetHours ? new Prisma.Decimal(budgetHours) : null,
        budgetAmount: budgetAmount ? new Prisma.Decimal(budgetAmount) : null,
        actualHours: new Prisma.Decimal(0),
        actualCost: new Prisma.Decimal(0),
        actualRevenue: new Prisma.Decimal(0),
        billingType: data.billingType as any || 'TIME_AND_MATERIALS',
        billRate: data.billRate ? new Prisma.Decimal(data.billRate) : null,
        managerId: data.managerId,
        notes: data.notes,
      },
    });
  }

  private async generateProjectNumber(organizationId: string): Promise<string> {
    const lastProject = await this.prisma.project.findFirst({
      where: { organizationId },
      orderBy: { projectNumber: 'desc' },
    });

    if (lastProject) {
      const lastNumber = parseInt(lastProject.projectNumber.replace(/\D/g, '')) || 0;
      return `PRJ-${String(lastNumber + 1).padStart(6, '0')}`;
    }
    return 'PRJ-000001';
  }

  async getProjects(organizationId: string, options?: {
    status?: string;
    customerId?: string;
    managerId?: string;
  }) {
    return this.prisma.project.findMany({
      where: {
        organizationId,
        ...(options?.status && { status: options.status as any }),
        ...(options?.customerId && { customerId: options.customerId }),
        ...(options?.managerId && { managerId: options.managerId }),
      },
      include: {
        customer: { select: { id: true, name: true } },
        _count: { select: { tasks: true, timesheets: true, expenses: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProject(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      include: {
        customer: true,
        tasks: { orderBy: { createdAt: 'asc' } },
        _count: { select: { tasks: true, timesheets: true, expenses: true, invoices: true } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async updateProject(organizationId: string, projectId: string, data: any) {
    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!existing) throw new NotFoundException('Project not found');

    const budgetHours = data.budgetHours ?? data.budgetedHours;
    const budgetAmount = data.budgetAmount ?? data.budgetedAmount;

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.status && { status: data.status }),
        ...(data.startDate && { startDate: data.startDate }),
        ...(data.endDate && { endDate: data.endDate }),
        ...(budgetHours !== undefined && { budgetHours: new Prisma.Decimal(budgetHours) }),
        ...(budgetAmount !== undefined && { budgetAmount: new Prisma.Decimal(budgetAmount) }),
        ...(data.billingType && { billingType: data.billingType }),
        ...(data.billRate !== undefined && { billRate: new Prisma.Decimal(data.billRate) }),
        ...(data.managerId !== undefined && { managerId: data.managerId }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  // Tasks
  async createTask(organizationId: string, projectId: string, data: {
    name: string;
    description?: string;
    assignedTo?: string;
    status?: string;
    priority?: string;
    estimatedHours?: number;
    dueDate?: Date;
  }) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.task.create({
      data: {
        organizationId,
        projectId,
        name: data.name,
        description: data.description,
        assignedTo: data.assignedTo,
        status: data.status || 'NOT_STARTED',
        priority: data.priority || 'MEDIUM',
        estimatedHours: data.estimatedHours ? new Prisma.Decimal(data.estimatedHours) : null,
        actualHours: new Prisma.Decimal(0),
        dueDate: data.dueDate,
      },
    });
  }

  async getTasks(organizationId: string, projectId: string, options?: { status?: string }) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.task.findMany({
      where: {
        projectId,
        ...(options?.status && { status: options.status }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateTask(organizationId: string, projectId: string, taskId: string, data: any) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
      include: { project: { select: { organizationId: true } } },
    });

    if (!task || task.project?.organizationId !== organizationId) {
      throw new NotFoundException('Task not found');
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
        ...(data.status && { status: data.status }),
        ...(data.priority && { priority: data.priority }),
        ...(data.estimatedHours !== undefined && { estimatedHours: new Prisma.Decimal(data.estimatedHours) }),
        ...(data.dueDate !== undefined && { dueDate: data.dueDate }),
        ...(data.status === 'COMPLETED' && !task.completedAt && { completedAt: new Date() }),
      },
    });
  }

  // Job Costing
  async getProjectCosts(organizationId: string, projectId: string) {
    const project = await this.getProject(organizationId, projectId);

    // Get labor costs from timesheets
    const timesheets = await this.prisma.timesheet.findMany({
      where: { projectId, status: 'APPROVED' },
    });

    const laborHours = timesheets.reduce((sum, ts) => sum + Number(ts.hours), 0);
    const laborCost = timesheets.reduce((sum, ts) => sum + Number(ts.hours) * Number(ts.hourlyRate || 0), 0);

    // Get expenses
    const expenses = await this.prisma.expense.findMany({
      where: { projectId },
    });

    const expenseCost = expenses.reduce((sum, exp) => sum + Number(exp.amount), 0);

    // Get materials/inventory
    // In production, would query inventory transactions linked to project

    const totalCost = laborCost + expenseCost;
    const revenue = Number(project.actualRevenue);
    const profit = revenue - totalCost;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      projectId,
      projectName: project.name,
      budgetedAmount: Number(project.budgetAmount || 0),
      budgetedHours: Number(project.budgetHours || 0),
      costs: {
        labor: {
          hours: laborHours,
          cost: laborCost,
          timesheetCount: timesheets.length,
        },
        expenses: {
          cost: expenseCost,
          count: expenses.length,
        },
        materials: {
          cost: 0, // Would calculate from inventory
          count: 0,
        },
        total: totalCost,
      },
      revenue,
      profit,
      profitMargin,
      budgetVariance: Number(project.budgetAmount || 0) - totalCost,
      hoursVariance: Number(project.budgetHours || 0) - laborHours,
    };
  }

  async getProjectProgress(organizationId: string, projectId: string) {
    const project = await this.getProject(organizationId, projectId);

    const totalTasks = project._count.tasks;
    const completedTasks = await this.prisma.task.count({
      where: { projectId, status: 'COMPLETED' },
    });

    const budgetedHours = Number(project.budgetHours || 0);
    const actualHours = Number(project.actualHours);
    const hoursProgress = budgetedHours > 0 ? (actualHours / budgetedHours) * 100 : 0;

    const budgetedAmount = Number(project.budgetAmount || 0);
    const actualCost = Number(project.actualCost);
    const costProgress = budgetedAmount > 0 ? (actualCost / budgetedAmount) * 100 : 0;

    return {
      projectId,
      projectName: project.name,
      status: project.status,
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        percentage: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
      },
      hours: {
        budgeted: budgetedHours,
        actual: actualHours,
        percentage: hoursProgress,
        remaining: budgetedHours - actualHours,
      },
      cost: {
        budgeted: budgetedAmount,
        actual: actualCost,
        percentage: costProgress,
        remaining: budgetedAmount - actualCost,
      },
      timeline: {
        startDate: project.startDate,
        endDate: project.endDate,
        daysRemaining: project.endDate ? 
          Math.ceil((new Date(project.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null,
      },
    };
  }

  async closeProject(organizationId: string, projectId: string) {
    const project = await this.getProject(organizationId, projectId);

    if (project.status === 'CLOSED') {
      throw new BadRequestException('Project already closed');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'CLOSED',
        completedAt: new Date(),
      },
    });
  }

  async reopenProject(organizationId: string, projectId: string) {
    const project = await this.getProject(organizationId, projectId);

    if (project.status !== 'CLOSED') {
      throw new BadRequestException('Project is not closed');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'ACTIVE',
        completedAt: null,
      },
    });
  }
}
