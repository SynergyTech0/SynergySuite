import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ClassificationCategory,
  DeductibilityStatus,
  ClassificationResultDto,
  TaxCitationDto,
} from '../dto/tax-classification.dto';

interface ClassificationContext {
  description: string;
  amount: number;
  accountType?: string;
  accountSubType?: string;
  vendor?: string;
  categoryHint?: string;
  context?: string;
  entityType?: string;
  industry?: string;
}

@Injectable()
export class AIClassifier {
  private readonly logger = new Logger(AIClassifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async classify(context: ClassificationContext): Promise<ClassificationResultDto> {
    // First, try rule-based classification for high-confidence cases
    const ruleBasedResult = await this.ruleBasedClassification(context);
    if (ruleBasedResult && ruleBasedResult.confidence >= 0.9) {
      return ruleBasedResult;
    }

    // Query knowledge graph for relevant rules
    const relevantRules = await this.queryKnowledgeGraph(context);

    // Use AI for complex classification
    const aiResult = await this.aiClassification(context, relevantRules);

    // Enhance with citations from knowledge graph
    const enhancedResult = await this.enhanceWithCitations(aiResult, context);

    return enhancedResult;
  }

  private async ruleBasedClassification(
    context: ClassificationContext,
  ): Promise<ClassificationResultDto | null> {
    const description = context.description.toLowerCase();
    const amount = context.amount;

    // Payroll-related
    if (this.matchesPatterns(description, ['salary', 'wages', 'payroll', 'wage expense'])) {
      return {
        category: ClassificationCategory.BUSINESS_EXPENSE_ORDINARY,
        confidence: 0.95,
        deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 162(a)(1)',
          text: 'Reasonable salaries and wages for personal services actually rendered',
          relevanceScore: 0.95,
        }],
        explanation: 'Wages and salaries are ordinary and necessary business expenses under IRC § 162',
        formPlacement: {
          form: '1120',
          line: '13',
        },
      };
    }

    // Rent expense
    if (this.matchesPatterns(description, ['rent', 'lease', 'office space', 'rental'])) {
      return {
        category: ClassificationCategory.BUSINESS_EXPENSE_ORDINARY,
        confidence: 0.92,
        deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 162(a)(3)',
          text: 'Rentals or other payments for the use of property',
          relevanceScore: 0.95,
        }],
        explanation: 'Business rent is an ordinary and necessary business expense under IRC § 162(a)(3)',
        formPlacement: {
          form: '1120',
          line: '16',
        },
      };
    }

    // Meals and entertainment
    if (this.matchesPatterns(description, ['meal', 'lunch', 'dinner', 'restaurant', 'food'])) {
      return {
        category: ClassificationCategory.MEALS_ENTERTAINMENT,
        confidence: 0.88,
        deductibility: DeductibilityStatus.PARTIALLY_DEDUCTIBLE,
        deductiblePercentage: 50,
        citations: [{
          section: 'IRC § 274(n)',
          text: 'Generally, meals are only 50% deductible',
          relevanceScore: 0.92,
        }],
        explanation: 'Business meals are generally limited to 50% deductibility under IRC § 274(n)',
        warnings: ['Ensure meals are directly related to or associated with business'],
        formPlacement: {
          form: '1120',
          line: '26',
        },
      };
    }

    // Travel expenses
    if (this.matchesPatterns(description, ['travel', 'airfare', 'flight', 'hotel', 'lodging'])) {
      return {
        category: ClassificationCategory.TRAVEL_EXPENSE,
        confidence: 0.90,
        deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 162(a)(2)',
          text: 'Traveling expenses while away from home in pursuit of trade or business',
          relevanceScore: 0.93,
        }],
        explanation: 'Business travel expenses are deductible under IRC § 162(a)(2)',
        warnings: ['Must be away from tax home overnight', 'Personal portion is not deductible'],
        formPlacement: {
          form: '1120',
          line: '26',
        },
      };
    }

    // Depreciation
    if (this.matchesPatterns(description, ['depreciation', 'amortization'])) {
      return {
        category: ClassificationCategory.DEPRECIATION_EXPENSE,
        confidence: 0.95,
        deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 167',
          text: 'Depreciation deduction for property used in trade or business',
          relevanceScore: 0.95,
        }, {
          section: 'IRC § 168',
          text: 'Accelerated cost recovery system (MACRS)',
          relevanceScore: 0.90,
        }],
        explanation: 'Depreciation allows cost recovery for business assets over time',
        formPlacement: {
          form: '4562',
          line: '22',
        },
      };
    }

    // Interest expense
    if (this.matchesPatterns(description, ['interest expense', 'loan interest', 'bank interest'])) {
      return {
        category: ClassificationCategory.INTEREST_EXPENSE_BUSINESS,
        confidence: 0.88,
        deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 163(a)',
          text: 'General rule for interest deduction',
          relevanceScore: 0.92,
        }, {
          section: 'IRC § 163(j)',
          text: 'Business interest limitation',
          relevanceScore: 0.85,
        }],
        explanation: 'Business interest is generally deductible, subject to IRC § 163(j) limitations',
        warnings: ['May be subject to business interest limitation for larger businesses'],
        formPlacement: {
          form: '1120',
          line: '18',
        },
      };
    }

    // Insurance
    if (this.matchesPatterns(description, ['insurance', 'premium', 'policy'])) {
      return {
        category: ClassificationCategory.BUSINESS_EXPENSE_ORDINARY,
        confidence: 0.90,
        deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 162(a)',
          text: 'Ordinary and necessary business expenses',
          relevanceScore: 0.90,
        }],
        explanation: 'Business insurance premiums are deductible as ordinary business expenses',
        formPlacement: {
          form: '1120',
          line: '26',
        },
      };
    }

    // Professional fees
    if (this.matchesPatterns(description, ['legal', 'accounting', 'consulting', 'professional fee', 'attorney'])) {
      return {
        category: ClassificationCategory.BUSINESS_EXPENSE_ORDINARY,
        confidence: 0.88,
        deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 162(a)',
          text: 'Ordinary and necessary business expenses',
          relevanceScore: 0.90,
        }],
        explanation: 'Professional fees for business purposes are deductible',
        warnings: ['Legal fees for personal matters are not deductible', 'Fees to acquire capital assets must be capitalized'],
        formPlacement: {
          form: '1120',
          line: '26',
        },
      };
    }

    // Revenue/Sales
    if (this.matchesPatterns(description, ['sales', 'revenue', 'service income', 'fee income'])) {
      return {
        category: ClassificationCategory.ORDINARY_INCOME,
        confidence: 0.92,
        deductibility: DeductibilityStatus.NON_DEDUCTIBLE,
        citations: [{
          section: 'IRC § 61(a)',
          text: 'Gross income includes all income from whatever source derived',
          relevanceScore: 0.95,
        }],
        explanation: 'Business revenue is includable in gross income under IRC § 61',
        formPlacement: {
          form: '1120',
          line: '1a',
        },
      };
    }

    // Charitable contributions
    if (this.matchesPatterns(description, ['donation', 'charitable', 'contribution', 'nonprofit'])) {
      return {
        category: ClassificationCategory.CHARITABLE_CONTRIBUTION,
        confidence: 0.85,
        deductibility: DeductibilityStatus.PARTIALLY_DEDUCTIBLE,
        deductiblePercentage: 10, // Corporate limit
        citations: [{
          section: 'IRC § 170(b)(2)',
          text: 'Corporate charitable deduction limited to 10% of taxable income',
          relevanceScore: 0.92,
        }],
        explanation: 'Corporate charitable contributions limited to 10% of taxable income',
        warnings: ['Must be made to qualified 501(c)(3) organization', 'Excess may be carried forward 5 years'],
        formPlacement: {
          form: '1120',
          line: '19',
        },
      };
    }

    return null;
  }

  private async queryKnowledgeGraph(context: ClassificationContext) {
    // Query relevant tax rules from the knowledge graph
    const keywords = this.extractKeywords(context.description);

    const rules = await this.prisma.taxRule.findMany({
      where: {
        OR: [
          { summary: { contains: keywords[0], mode: 'insensitive' } },
          { ruleText: { contains: keywords[0], mode: 'insensitive' } },
        ],
      },
      include: {
        section: {
          include: {
            document: true,
          },
        },
      },
      take: 10,
    });

    // Also query definitions
    const definitions = await this.prisma.taxDefinition.findMany({
      where: {
        OR: [
          { term: { contains: keywords[0], mode: 'insensitive' } },
          { definition: { contains: keywords[0], mode: 'insensitive' } },
        ],
      },
      take: 5,
    });

    return { rules, definitions };
  }

  private async aiClassification(
    context: ClassificationContext,
    knowledgeBase: any,
  ): Promise<ClassificationResultDto> {
    // Build prompt with context and knowledge base
    const prompt = this.buildClassificationPrompt(context, knowledgeBase);

    // For now, return a default classification
    // In production, this would call the AI service
    return {
      category: ClassificationCategory.BUSINESS_EXPENSE_ORDINARY,
      confidence: 0.75,
      deductibility: DeductibilityStatus.FULLY_DEDUCTIBLE,
      citations: [],
      explanation: 'Classified based on transaction characteristics',
      alternatives: [
        {
          category: ClassificationCategory.NON_DEDUCTIBLE,
          confidence: 0.15,
          reason: 'Could be personal if not business-related',
        },
      ],
    };
  }

  private async enhanceWithCitations(
    result: ClassificationResultDto,
    context: ClassificationContext,
  ): Promise<ClassificationResultDto> {
    // Query for relevant citations based on classification
    const categoryRules = await this.prisma.taxRule.findMany({
      where: {
        category: this.mapCategoryToRuleCategory(result.category),
      },
      include: {
        section: true,
      },
      take: 3,
    });

    // Add citations from knowledge graph
    const additionalCitations: TaxCitationDto[] = categoryRules.map((rule) => ({
      section: rule.section?.sectionNumber || '',
      text: rule.summary ?? undefined,
      relevanceScore: 0.8,
    }));

    return {
      ...result,
      citations: [...result.citations, ...additionalCitations],
    };
  }

  private matchesPatterns(text: string, patterns: string[]): boolean {
    return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
  }

  private extractKeywords(description: string): string[] {
    // Simple keyword extraction - remove common words
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    const words = description.toLowerCase().split(/\s+/);
    return words.filter((word) => !stopWords.includes(word) && word.length > 2);
  }

  private buildClassificationPrompt(context: ClassificationContext, knowledgeBase: any): string {
    return `
Classify the following transaction for tax purposes:

Description: ${context.description}
Amount: $${context.amount}
Account Type: ${context.accountType || 'Unknown'}
Vendor: ${context.vendor || 'Unknown'}
Entity Type: ${context.entityType || 'Unknown'}
Industry: ${context.industry || 'Unknown'}

Relevant Tax Rules:
${knowledgeBase.rules.map((r: any) => `- ${r.summary}`).join('\n')}

Relevant Definitions:
${knowledgeBase.definitions.map((d: any) => `- ${d.term}: ${d.definition}`).join('\n')}

Classify this transaction into one of the following categories and provide:
1. Category
2. Confidence level (0-1)
3. Deductibility status
4. Relevant IRC citations
5. Brief explanation
`;
  }

  private mapCategoryToRuleCategory(category: ClassificationCategory): string {
    const mapping: Record<ClassificationCategory, string> = {
      [ClassificationCategory.BUSINESS_EXPENSE_ORDINARY]: 'deduction',
      [ClassificationCategory.BUSINESS_EXPENSE_NECESSARY]: 'deduction',
      [ClassificationCategory.DEPRECIATION_EXPENSE]: 'depreciation',
      [ClassificationCategory.MEALS_ENTERTAINMENT]: 'meals_entertainment',
      [ClassificationCategory.TRAVEL_EXPENSE]: 'travel',
      [ClassificationCategory.CHARITABLE_CONTRIBUTION]: 'charitable',
      [ClassificationCategory.INTEREST_EXPENSE_BUSINESS]: 'interest',
      [ClassificationCategory.ORDINARY_INCOME]: 'income',
      // Add more mappings
    } as any;

    return mapping[category] || 'general';
  }
}
