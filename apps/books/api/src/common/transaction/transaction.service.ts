import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TransactionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Execute a function within a database transaction
   * Automatically rolls back on error
   */
  async run<T>(
    fn: (prisma: any) => Promise<T>,
    operationName: string = 'operation',
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        return await fn(tx);
      });
    } catch (error) {
      throw new Error(`Transaction failed for ${operationName}: ${(error as Error).message}`);
    }
  }

  /**
   * Execute multiple operations atomically
   */
  async runMultiple<T>(
    operations: Array<(prisma: any) => Promise<any>>,
    operationName: string = 'batch-operation',
  ): Promise<T[]> {
    try {
      return await this.prisma.$transaction(
        operations.map((op) => op(this.prisma)) as any,
      );
    } catch (error) {
      throw new Error(
        `Batch transaction failed for ${operationName}: ${(error as Error).message}`,
      );
    }
  }
}
