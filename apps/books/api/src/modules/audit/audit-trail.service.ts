import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAuditEntry(
    organizationId: string,
    actionType: string,
    entityType: string,
    entityId: string,
    userId: string,
    changes?: any,
    notes?: string,
    ipAddress?: string,
    userEmail?: string,
  ) {
    const entry = await this.prisma.auditTrailEntry.create({
      data: {
        id: uuidv4(),
        organizationId,
        actionType: actionType as any,
        entityType,
        entityId,
        userId,
        userEmail,
        changes,
        notes,
        ipAddress,
      },
    });

    this.logger.log(`Audit entry created: ${actionType} on ${entityType} ${entityId}`);
    return entry;
  }

  async getAuditTrail(organizationId: string, filters?: { entityType?: string; entityId?: string; userId?: string; actionType?: string; startDate?: Date; endDate?: Date }) {
    return this.prisma.auditTrailEntry.findMany({
      where: {
        organizationId,
        ...(filters?.entityType && { entityType: filters.entityType }),
        ...(filters?.entityId && { entityId: filters.entityId }),
        ...(filters?.userId && { userId: filters.userId }),
        ...(filters?.actionType && { actionType: filters.actionType as any }),
        ...(filters?.startDate && {
          createdAt: {
            gte: filters.startDate,
            ...(filters?.endDate && { lte: filters.endDate }),
          },
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
  }

  async getUserActivity(organizationId: string, userId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const entries = await this.prisma.auditTrailEntry.findMany({
      where: {
        organizationId,
        userId,
        createdAt: {
          gte: startDate,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by action type
    const grouped = entries.reduce(
      (acc, entry) => {
        const action = entry.actionType;
        acc[action] = (acc[action] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      userId,
      totalActions: entries.length,
      actionBreakdown: grouped,
      entries,
    };
  }

  async getEntityHistory(organizationId: string, entityType: string, entityId: string) {
    return this.prisma.auditTrailEntry.findMany({
      where: {
        organizationId,
        entityType,
        entityId,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async generateAuditReport(organizationId: string, startDate: Date, endDate: Date) {
    const entries = await this.prisma.auditTrailEntry.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Aggregate stats
    const stats = {
      totalActions: entries.length,
      actionTypes: {} as Record<string, number>,
      entityTypes: {} as Record<string, number>,
      userActions: {} as Record<string, number>,
    };

    entries.forEach((entry) => {
      stats.actionTypes[entry.actionType] = (stats.actionTypes[entry.actionType] || 0) + 1;
      stats.entityTypes[entry.entityType] = (stats.entityTypes[entry.entityType] || 0) + 1;
      stats.userActions[entry.userId] = (stats.userActions[entry.userId] || 0) + 1;
    });

    return {
      periodStart: startDate,
      periodEnd: endDate,
      stats,
      entries,
    };
  }
}
