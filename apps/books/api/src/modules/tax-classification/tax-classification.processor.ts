import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TaxClassificationService } from './tax-classification.service';

@Processor('tax-classification')
export class TaxClassificationProcessor {
  private readonly logger = new Logger(TaxClassificationProcessor.name);

  constructor(
    private readonly classificationService: TaxClassificationService,
  ) {}

  @Process('classify-journal')
  async handleClassifyJournal(job: Job<{ journalId: string; organizationId: string }>) {
    this.logger.log(`Processing classification for journal ${job.data.journalId}`);

    try {
      const result = await this.classificationService.classifyJournal(
        job.data.organizationId,
        job.data.journalId,
      );

      this.logger.log(
        `Classified ${result.lineClassifications.length} lines for journal ${job.data.journalId}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to classify journal ${job.data.journalId}:`, error);
      throw error;
    }
  }

  @Process('classify-transaction')
  async handleClassifyTransaction(
    job: Job<{
      organizationId: string;
      transactionId: string;
      description: string;
      amount: number;
      accountId: string;
    }>,
  ) {
    this.logger.log(`Processing classification for transaction ${job.data.transactionId}`);

    try {
      const result = await this.classificationService.classifyTransaction(
        job.data.organizationId,
        {
          description: job.data.description,
          amount: job.data.amount,
          accountId: job.data.accountId,
        },
      );

      this.logger.log(
        `Classified transaction ${job.data.transactionId} as ${result.category}`,
      );

      return {
        transactionId: job.data.transactionId,
        classification: result,
      };
    } catch (error) {
      this.logger.error(
        `Failed to classify transaction ${job.data.transactionId}:`,
        error,
      );
      throw error;
    }
  }

  @Process('batch-classify')
  async handleBatchClassify(
    job: Job<{
      organizationId: string;
      items: Array<{
        id: string;
        description: string;
        amount: number;
        accountId: string;
      }>;
    }>,
  ) {
    this.logger.log(`Processing batch classification of ${job.data.items.length} items`);

    const results = [];
    let processed = 0;

    for (const item of job.data.items) {
      try {
        const result = await this.classificationService.classifyTransaction(
          job.data.organizationId,
          {
            description: item.description,
            amount: item.amount,
            accountId: item.accountId,
          },
        );

        results.push({
          id: item.id,
          success: true,
          classification: result,
        });
      } catch (error) {
        results.push({
          id: item.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      processed++;

      // Update progress
      await job.progress(Math.round((processed / job.data.items.length) * 100));
    }

    this.logger.log(
      `Batch classification complete: ${results.filter((r) => r.success).length}/${job.data.items.length} successful`,
    );

    return {
      total: job.data.items.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  @Process('reclassify-all')
  async handleReclassifyAll(job: Job<{ organizationId: string; fiscalPeriodId?: string }>) {
    this.logger.log(`Reclassifying all transactions for organization ${job.data.organizationId}`);

    // This would reclassify all transactions when tax rules are updated
    // Implementation would iterate through all journal lines and reclassify

    return { status: 'completed' };
  }
}
