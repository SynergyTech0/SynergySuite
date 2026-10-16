import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { TaxClassificationService } from './tax-classification.service';
import {
  ClassifyTransactionDto,
  BatchClassifyDto,
  ClassificationFeedbackDto,
  ClassificationResultDto,
  ClassificationCategory,
} from './dto/tax-classification.dto';

@ApiTags('tax-classification')
@ApiBearerAuth()
@Controller('organizations/:organizationId/tax-classification')
export class TaxClassificationController {
  constructor(
    private readonly taxClassificationService: TaxClassificationService,
  ) {}

  @Post('classify')
  @ApiOperation({ summary: 'Classify a single transaction' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 200,
    description: 'Classification result',
    type: ClassificationResultDto,
  })
  async classifyTransaction(
    @Param('organizationId') organizationId: string,
    @Body() dto: ClassifyTransactionDto,
  ) {
    return this.taxClassificationService.classifyTransaction(organizationId, dto);
  }

  @Post('classify/batch')
  @ApiOperation({ summary: 'Classify multiple transactions' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async batchClassify(
    @Param('organizationId') organizationId: string,
    @Body() dto: BatchClassifyDto,
  ) {
    return this.taxClassificationService.batchClassify(organizationId, dto.items);
  }

  @Post('classify/journal/:journalId')
  @ApiOperation({ summary: 'Classify all lines in a journal entry' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'journalId', description: 'Journal entry ID' })
  async classifyJournal(
    @Param('organizationId') organizationId: string,
    @Param('journalId') journalId: string,
  ) {
    return this.taxClassificationService.classifyJournal(organizationId, journalId);
  }

  @Post('classify/journal-line/:journalLineId')
  @ApiOperation({ summary: 'Classify a specific journal line' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'journalLineId', description: 'Journal line ID' })
  async classifyJournalLine(
    @Param('organizationId') organizationId: string,
    @Param('journalLineId') journalLineId: string,
  ) {
    return this.taxClassificationService.classifyJournalLine(
      organizationId,
      journalLineId,
    );
  }

  @Post('feedback')
  @ApiOperation({ summary: 'Submit feedback on a classification' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async submitFeedback(
    @Param('organizationId') organizationId: string,
    @Body() dto: ClassificationFeedbackDto,
  ) {
    return this.taxClassificationService.submitFeedback(organizationId, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get classification history' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'category', required: false, enum: ClassificationCategory })
  @ApiQuery({ name: 'minConfidence', required: false, type: Number })
  async getHistory(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('category') category?: ClassificationCategory,
    @Query('minConfidence') minConfidence?: string,
  ) {
    return this.taxClassificationService.getClassificationHistory(organizationId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      category,
      minConfidence: minConfidence ? parseFloat(minConfidence) : undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get classification statistics' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async getStats(@Param('organizationId') organizationId: string) {
    return this.taxClassificationService.getClassificationStats(organizationId);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get available classification categories' })
  async getCategories() {
    return Object.values(ClassificationCategory).map((category) => ({
      value: category,
      label: this.formatCategoryLabel(category),
      group: this.getCategoryGroup(category),
    }));
  }

  private formatCategoryLabel(category: string): string {
    return category
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private getCategoryGroup(category: ClassificationCategory): string {
    if (category.includes('INCOME') || category.includes('GAIN') || category.includes('DIVIDEND')) {
      return 'Income';
    }
    if (category.includes('EXPENSE') || category.includes('DEPRECIATION') || category.includes('AMORTIZATION')) {
      return 'Expenses';
    }
    if (category.includes('DEDUCTIBLE') || category.includes('CONTRIBUTION')) {
      return 'Deductions';
    }
    if (category.includes('LIABILITY') || category.includes('TAX')) {
      return 'Tax';
    }
    return 'Other';
  }
}
