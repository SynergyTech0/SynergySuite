import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createImport(organizationId: string, importType: string, fileName: string, rowCount: number, userId: string, mappingConfig?: any) {
    const bulkImport = await this.prisma.bulkImport.create({
      data: {
        id: uuidv4(),
        organizationId,
        importType,
        fileName,
        rowCount,
        mappingConfig: mappingConfig || {},
        importedBy: userId,
      },
    });

    this.logger.log(`Bulk import ${bulkImport.id} created for ${importType}`);
    return bulkImport;
  }

  async addImportRow(importId: string, rowNumber: number, data: any) {
    return this.prisma.bulkImportRow.create({
      data: {
        id: uuidv4(),
        importId,
        rowNumber,
        data,
        status: 'PENDING',
      },
    });
  }

  async processImportRow(importId: string, rowNumber: number) {
    const row = await this.prisma.bulkImportRow.findUnique({
      where: {
        importId_rowNumber: {
          importId,
          rowNumber,
        },
      },
    });

    if (!row) {
      throw new BadRequestException('Import row not found');
    }

    // Validate and process based on import type
    const bulkImport = await this.prisma.bulkImport.findUnique({
      where: { id: importId },
    });

    const errors: string[] = [];
    // Row data is a JSON object keyed by (mapped) column name.
    const data: Prisma.JsonObject =
      row.data !== null && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Prisma.JsonObject)
        : {};
    let createdEntityId: string | null = null;

    try {
      // Process based on import type
      // This is a placeholder - actual implementation depends on import type
      if (bulkImport?.importType === 'CUSTOMERS') {
        // Validate customer data
        if (!data.name) errors.push('Name is required');
        if (!data.email) errors.push('Email is required');
      } else if (bulkImport?.importType === 'VENDORS') {
        // Validate vendor data
        if (!data.name) errors.push('Name is required');
      } else if (bulkImport?.importType === 'TRANSACTIONS') {
        // Validate transaction data
        if (!data.description) errors.push('Description is required');
        if (!data.amount) errors.push('Amount is required');
      }

      let status = 'SUCCESS';
      if (errors.length > 0) {
        status = 'ERROR';
      }

      const updated = await this.prisma.bulkImportRow.update({
        where: {
          importId_rowNumber: {
            importId,
            rowNumber,
          },
        },
        data: {
          status,
          errors: errors.length > 0 ? errors : Prisma.DbNull,
          createdEntityId,
        },
      });

      // Update import stats
      await this.updateImportStats(importId);

      return updated;
    } catch (error) {
      await this.prisma.bulkImportRow.update({
        where: {
          importId_rowNumber: {
            importId,
            rowNumber,
          },
        },
        data: {
          status: 'ERROR',
          errors: [(error as Error).message],
        },
      });

      throw error;
    }
  }

  async updateImportStats(importId: string) {
    const rows = await this.prisma.bulkImportRow.findMany({
      where: { importId },
    });

    const successCount = rows.filter((r) => r.status === 'SUCCESS').length;
    const errorCount = rows.filter((r) => r.status === 'ERROR').length;
    const allProcessed = rows.every((r) => r.status !== 'PENDING');

    await this.prisma.bulkImport.update({
      where: { id: importId },
      data: {
        successCount,
        errorCount,
        status: allProcessed ? 'COMPLETED' : 'PROCESSING',
        completedAt: allProcessed ? new Date() : null,
      },
    });
  }

  async getImport(organizationId: string, importId: string) {
    const bulkImport = await this.prisma.bulkImport.findUnique({
      where: { id: importId },
      include: { rows: true },
    });

    if (!bulkImport || bulkImport.organizationId !== organizationId) {
      throw new BadRequestException('Import not found');
    }

    return bulkImport;
  }

  async listImports(organizationId: string, filters?: { status?: string; importType?: string }) {
    return this.prisma.bulkImport.findMany({
      where: {
        organizationId,
        ...(filters?.status && { status: filters.status as any }),
        ...(filters?.importType && { importType: filters.importType }),
      },
      include: { rows: { take: 5 } }, // Preview first 5 rows
      orderBy: { createdAt: 'desc' },
    });
  }

  async getImportErrors(importId: string) {
    const rows = await this.prisma.bulkImportRow.findMany({
      where: {
        importId,
        status: 'ERROR',
      },
    });

    return rows;
  }

  async retryImport(organizationId: string, importId: string) {
    const bulkImport = await this.getImport(organizationId, importId);

    if (bulkImport.status === 'COMPLETED') {
      throw new BadRequestException('Cannot retry completed import');
    }

    // Reset all rows to PENDING
    await this.prisma.bulkImportRow.updateMany({
      where: { importId },
      data: { status: 'PENDING', errors: Prisma.DbNull },
    });

    const updated = await this.prisma.bulkImport.update({
      where: { id: importId },
      data: {
        status: 'PENDING',
        successCount: 0,
        errorCount: 0,
        completedAt: null,
      },
    });

    return updated;
  }
}
