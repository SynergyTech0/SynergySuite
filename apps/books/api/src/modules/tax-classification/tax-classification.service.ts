import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { AIClassifier } from './classifiers/ai.classifier';
import { TaxRuleEngine } from './engines/tax-rule.engine';
import { CitationGenerator } from './generators/citation.generator';
import {
  ClassifyTransactionDto,
  ClassificationResultDto,
  ClassificationFeedbackDto,
  ClassificationCategory,
} from './dto/tax-classification.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TaxClassificationService {
  private readonly logger = new Logger(TaxClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClassifier: AIClassifier,
    private readonly ruleEngine: TaxRuleEngine,
    private readonly citationGenerator: CitationGenerator,
    @InjectQueue('tax-classification') private readonly classificationQueue: Queue,
  ) {}

  async classifyTransaction(
    organizationId: string,
    dto: ClassifyTransactionDto,
  ): Promise<ClassificationResultDto> {
    this.logger.log(`Classifying transaction: ${dto.description}`);

    // Get account details
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });

    if (!account) {
      throw new NotFoundException(`Account ${dto.accountId} not found`);
    }

    // Get organization for entity type
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    // Build classification context
    const context = {
      description: dto.description,
      amount: dto.amount,
      accountType: account.accountType,
      accountSubType: account.accountSubtype || undefined,
      vendor: dto.vendor,
      categoryHint: dto.categoryHint,
      context: dto.context,
      entityType: organization?.entityType,
      industry: organization?.industry || undefined,
    };

    // Run AI classification
    const result = await this.aiClassifier.classify(context);

    // Enhance with rule engine checks
    const specialRules = await this.ruleEngine.checkSpecialRules(
      result.category,
      context,
    );

    // Get form placement
    const formPlacement = await this.ruleEngine.getFormPlacement(
      result.category,
      organization?.entityType || 'C_CORP',
    );

    // Get applicable limitations
    const limitations = await this.ruleEngine.getApplicableLimitations(
      result.category,
      context,
    );

    // Generate additional citations
    const additionalCitations = await this.citationGenerator.generateCitations(
      result.category,
      context,
    );

    // Merge citations (avoid duplicates)
    const allCitations = [...result.citations];
    for (const citation of additionalCitations) {
      if (!allCitations.some((c) => c.section === citation.section)) {
        allCitations.push(citation);
      }
    }

    // Build warnings
    const warnings = [...(result.warnings || [])];

    if (specialRules.relatedPartyRules) {
      warnings.push('Transaction may be subject to related party rules (IRC § 267, § 707)');
    }
    if (specialRules.atRiskLimitations) {
      warnings.push('At-risk limitations may apply (IRC § 465)');
    }
    if (specialRules.passiveActivityRules) {
      warnings.push('Passive activity limitations may apply (IRC § 469)');
    }
    if (limitations.length > 0) {
      limitations.forEach((lim) => {
        warnings.push(`Limitation: ${lim.description}`);
      });
    }

    // Add special rule notes
    if (specialRules.section179Eligible) {
      result.alternatives = result.alternatives || [];
      result.alternatives.push({
        category: ClassificationCategory.SECTION_179,
        confidence: 0.8,
        reason: 'May qualify for Section 179 immediate expensing',
      });
    }
    if (specialRules.bonusDepreciationEligible) {
      result.alternatives = result.alternatives || [];
      result.alternatives.push({
        category: ClassificationCategory.BONUS_DEPRECIATION,
        confidence: 0.8,
        reason: 'May qualify for bonus depreciation',
      });
    }
    if (specialRules.deMinimisApplicable) {
      warnings.push('May qualify for de minimis safe harbor (Treas. Reg. § 1.263(a)-1(f))');
    }

    return {
      ...result,
      citations: allCitations.slice(0, 5),
      warnings,
      formPlacement,
    };
  }

  async classifyJournalLine(organizationId: string, journalLineId: string) {
    const journalLine = await this.prisma.journalLine.findUnique({
      where: { id: journalLineId },
      include: {
        journal: true,
        account: true,
      },
    });

    if (!journalLine) {
      throw new NotFoundException(`Journal line ${journalLineId} not found`);
    }

    // Build transaction DTO from journal line
    const dto: ClassifyTransactionDto = {
      description: journalLine.description || journalLine.journal.description || '',
      amount: journalLine.debit
        ? parseFloat(journalLine.debit.toString())
        : parseFloat(journalLine.credit?.toString() || '0'),
      accountId: journalLine.accountId,
    };

    const result = await this.classifyTransaction(organizationId, dto);

    // Store classification
    await this.storeClassification(journalLineId, result);

    return result;
  }

  async classifyJournal(organizationId: string, journalId: string) {
    const journal = await this.prisma.journal.findUnique({
      where: { id: journalId },
      include: {
        lines: {
          include: {
            account: true,
          },
        },
      },
    });

    if (!journal) {
      throw new NotFoundException(`Journal ${journalId} not found`);
    }

    const results = await Promise.all(
      journal.lines.map((line) =>
        this.classifyJournalLine(organizationId, line.id),
      ),
    );

    return {
      journalId,
      lineClassifications: journal.lines.map((line, index) => ({
        lineId: line.id,
        accountCode: line.account.accountNumber,
        accountName: line.account.name,
        amount: line.debit || line.credit,
        classification: results[index],
      })),
    };
  }

  async batchClassify(organizationId: string, items: ClassifyTransactionDto[]) {
    const results = await Promise.all(
      items.map((item) => this.classifyTransaction(organizationId, item)),
    );

    return {
      total: items.length,
      classified: results.length,
      results: items.map((item, index) => ({
        input: item,
        classification: results[index],
      })),
    };
  }

  async submitFeedback(organizationId: string, dto: ClassificationFeedbackDto) {
    const classification = await this.prisma.journalLineTaxClassification.findUnique({
      where: { id: dto.classificationId },
    });

    if (!classification) {
      throw new NotFoundException(`Classification ${dto.classificationId} not found`);
    }

    // Store feedback for model improvement
    await this.prisma.classificationFeedback.create({
      data: {
        id: uuidv4(),
        journalLineTaxClassificationId: dto.classificationId,
        originalCategory: classification.category,
        suggestedCategory: dto.correctCategory || classification.category,
        isCorrect: dto.isCorrect,
        notes: dto.notes,
        createdBy: 'user', // In production, get from auth context
      },
    });

    // If incorrect, update classification
    if (!dto.isCorrect && dto.correctCategory) {
      await this.prisma.journalLineTaxClassification.update({
        where: { id: dto.classificationId },
        data: {
          category: dto.correctCategory,
          confidence: 1.0, // User confirmed
          isManualOverride: true,
        },
      });
    }

    return { success: true };
  }

  async getClassificationHistory(
    organizationId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      category?: ClassificationCategory;
      minConfidence?: number;
    } = {},
  ) {
    const where: any = {};

    if (options.category) {
      where.category = options.category;
    }
    if (options.minConfidence) {
      where.confidence = { gte: options.minConfidence };
    }

    const classifications = await this.prisma.journalLineTaxClassification.findMany({
      where,
      include: {
        journalLine: {
          include: {
            journal: true,
            account: true,
          },
        },
        citations: true,
      },
      orderBy: { classifiedAt: 'desc' },
      take: 100,
    });

    return classifications;
  }

  async getClassificationStats(organizationId: string) {
    const stats = await this.prisma.journalLineTaxClassification.groupBy({
      by: ['category'],
      _count: { id: true },
      _avg: { confidence: true },
    });

    const feedbackStats = await this.prisma.classificationFeedback.groupBy({
      by: ['isCorrect'],
      _count: { id: true },
    });

    return {
      byCategory: stats.map((s) => ({
        category: s.category,
        count: s._count.id,
        avgConfidence: s._avg.confidence,
      })),
      accuracy: this.calculateAccuracy(feedbackStats),
    };
  }

  private async storeClassification(
    journalLineId: string,
    result: ClassificationResultDto,
  ) {
    const classificationId = uuidv4();

    // Create classification record
    await this.prisma.journalLineTaxClassification.create({
      data: {
        id: classificationId,
        journalLineId,
        category: result.category,
        confidence: result.confidence,
        deductibility: result.deductibility,
        deductiblePercentage: result.deductiblePercentage,
        explanation: result.explanation,
        formPlacement: result.formPlacement as any,
        classifiedAt: new Date(),
      },
    });

    // Create citation records
    for (const citation of result.citations) {
      await this.prisma.taxCitation.create({
        data: {
          id: uuidv4(),
          journalLineTaxClassificationId: classificationId,
          section: citation.section,
          regulation: citation.regulation,
          publication: citation.publication,
          courtCase: citation.courtCase,
          citationText: citation.text,
          relevanceScore: citation.relevanceScore,
        },
      });
    }

    return classificationId;
  }

  private calculateAccuracy(
    feedbackStats: Array<{ isCorrect: boolean | null; _count: { id: number } }>,
  ): number {
    // Feedback with isCorrect = null has not been judged yet, so it is excluded
    const correct = feedbackStats.find((s) => s.isCorrect === true)?._count.id || 0;
    const incorrect = feedbackStats.find((s) => s.isCorrect === false)?._count.id || 0;
    const total = correct + incorrect;

    return total > 0 ? correct / total : 1.0;
  }
}
