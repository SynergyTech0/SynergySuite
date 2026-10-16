import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ClassificationCategory,
  DeductibilityStatus,
} from '../dto/tax-classification.dto';

interface RuleMatch {
  ruleId: string;
  category: ClassificationCategory;
  deductibility: DeductibilityStatus;
  deductiblePercentage?: number;
  confidence: number;
  citations: Array<{
    section: string;
    regulation?: string;
    text: string;
  }>;
  conditions?: string[];
  warnings?: string[];
}

interface TransactionContext {
  description: string;
  amount: number;
  accountType: string;
  accountSubType?: string;
  vendor?: string;
  entityType?: string;
  industry?: string;
  taxYear?: number;
}

@Injectable()
export class TaxRuleEngine {
  private readonly logger = new Logger(TaxRuleEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluateRules(context: TransactionContext): Promise<RuleMatch[]> {
    const matches: RuleMatch[] = [];

    // Get applicable rules based on account type
    const accountTypeRules = await this.getRulesByAccountType(context.accountType);

    // Evaluate each rule
    for (const rule of accountTypeRules) {
      const match = await this.evaluateRule(rule, context);
      if (match && match.confidence > 0.5) {
        matches.push(match);
      }
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    return matches;
  }

  async getApplicableLimitations(
    category: ClassificationCategory,
    context: TransactionContext,
  ) {
    const limitations = await this.prisma.taxLimitation.findMany({
      where: {
        effectiveDate: { lte: new Date() },
        OR: [
          { expirationDate: null },
          { expirationDate: { gte: new Date() } },
        ],
      },
      include: {
        section: true,
      },
    });

    // Filter limitations applicable to this category
    const applicable = limitations.filter((lim) => {
      return this.isLimitationApplicable(lim, category, context);
    });

    return applicable.map((lim) => ({
      type: lim.limitationType,
      threshold: lim.thresholdValue,
      percentage: lim.thresholdPercentage,
      description: lim.description,
      citation: lim.section?.sectionNumber,
      phaseout: lim.phaseoutStart ? {
        start: lim.phaseoutStart,
        end: lim.phaseoutEnd,
      } : undefined,
    }));
  }

  async getApplicableExceptions(
    category: ClassificationCategory,
    context: TransactionContext,
  ) {
    const exceptions = await this.prisma.taxException.findMany({
      where: {
        effectiveDate: { lte: new Date() },
        OR: [
          { expirationDate: null },
          { expirationDate: { gte: new Date() } },
        ],
      },
      include: {
        section: true,
      },
    });

    // Filter exceptions applicable to this category
    const applicable = exceptions.filter((exc) => {
      return this.isExceptionApplicable(exc, category, context);
    });

    return applicable.map((exc) => ({
      type: exc.exceptionType,
      description: exc.description,
      conditions: exc.condition,
      citation: exc.section?.sectionNumber,
    }));
  }

  async checkSpecialRules(
    category: ClassificationCategory,
    context: TransactionContext,
  ): Promise<{
    section179Eligible: boolean;
    bonusDepreciationEligible: boolean;
    deMinimisApplicable: boolean;
    relatedPartyRules: boolean;
    atRiskLimitations: boolean;
    passiveActivityRules: boolean;
  }> {
    const result = {
      section179Eligible: false,
      bonusDepreciationEligible: false,
      deMinimisApplicable: false,
      relatedPartyRules: false,
      atRiskLimitations: false,
      passiveActivityRules: false,
    };

    // Check Section 179 eligibility
    if (category === ClassificationCategory.CAPITAL_EXPENDITURE) {
      result.section179Eligible = await this.checkSection179Eligibility(context);
      result.bonusDepreciationEligible = await this.checkBonusDepreciationEligibility(context);
    }

    // Check de minimis safe harbor
    if (context.amount <= 2500) { // or $5000 with AFS
      result.deMinimisApplicable = true;
    }

    // Check for related party transactions
    result.relatedPartyRules = await this.checkRelatedPartyRules(context);

    // Check at-risk limitations for certain entity types
    if (['PARTNERSHIP', 'S_CORP', 'LLC'].includes(context.entityType || '')) {
      result.atRiskLimitations = true;
      result.passiveActivityRules = true;
    }

    return result;
  }

  async getFormPlacement(
    category: ClassificationCategory,
    entityType: string,
  ): Promise<{
    form: string;
    line?: string;
    schedule?: string;
    instructions?: string;
  }> {
    // Form placement based on entity type and category
    const placements: Record<string, Record<string, any>> = {
      C_CORP: {
        [ClassificationCategory.ORDINARY_INCOME]: { form: '1120', line: '1a' },
        [ClassificationCategory.COGS]: { form: '1120', line: '2' },
        [ClassificationCategory.BUSINESS_EXPENSE_ORDINARY]: { form: '1120', line: '26' },
        [ClassificationCategory.DEPRECIATION_EXPENSE]: { form: '1120', line: '20', schedule: '4562' },
        [ClassificationCategory.INTEREST_EXPENSE_BUSINESS]: { form: '1120', line: '18' },
        [ClassificationCategory.CHARITABLE_CONTRIBUTION]: { form: '1120', line: '19' },
        [ClassificationCategory.PAYROLL_TAX]: { form: '1120', line: '17' },
      },
      S_CORP: {
        [ClassificationCategory.ORDINARY_INCOME]: { form: '1120-S', line: '1a' },
        [ClassificationCategory.COGS]: { form: '1120-S', line: '2' },
        [ClassificationCategory.BUSINESS_EXPENSE_ORDINARY]: { form: '1120-S', line: '19' },
        [ClassificationCategory.DEPRECIATION_EXPENSE]: { form: '1120-S', line: '14', schedule: '4562' },
      },
      PARTNERSHIP: {
        [ClassificationCategory.ORDINARY_INCOME]: { form: '1065', line: '1a' },
        [ClassificationCategory.COGS]: { form: '1065', line: '2' },
        [ClassificationCategory.BUSINESS_EXPENSE_ORDINARY]: { form: '1065', line: '20' },
        [ClassificationCategory.DEPRECIATION_EXPENSE]: { form: '1065', line: '16a', schedule: '4562' },
      },
      SOLE_PROPRIETORSHIP: {
        [ClassificationCategory.ORDINARY_INCOME]: { form: '1040', schedule: 'C', line: '1' },
        [ClassificationCategory.COGS]: { form: '1040', schedule: 'C', line: '4' },
        [ClassificationCategory.BUSINESS_EXPENSE_ORDINARY]: { form: '1040', schedule: 'C', line: '27a' },
        [ClassificationCategory.DEPRECIATION_EXPENSE]: { form: '1040', schedule: 'C', line: '13' },
        [ClassificationCategory.HOME_OFFICE]: { form: '8829' },
        [ClassificationCategory.VEHICLE_EXPENSE]: { form: '4562', schedule: 'C', line: '9' },
      },
    };

    const entityPlacements = placements[entityType] || placements.C_CORP;
    return entityPlacements[category] || { form: 'Unknown', instructions: 'Consult tax professional' };
  }

  private async getRulesByAccountType(accountType: string) {
    // Query rules from knowledge graph based on account type
    const categoryMapping: Record<string, string[]> = {
      REVENUE: ['income', 'gross_receipts'],
      EXPENSE: ['deduction', 'expense'],
      ASSET: ['asset', 'property', 'depreciation'],
      LIABILITY: ['liability', 'debt'],
      EQUITY: ['equity', 'capital'],
    };

    const categories = categoryMapping[accountType] || ['general'];

    const rules = await this.prisma.taxRule.findMany({
      where: {
        category: { in: categories },
      },
      include: {
        section: true,
      },
      take: 50,
    });

    return rules;
  }

  private async evaluateRule(rule: any, context: TransactionContext): Promise<RuleMatch | null> {
    // Simplified rule evaluation - in production this would be more sophisticated
    let confidence = 0.5;

    // Check if rule text matches context
    const ruleText = (rule.ruleText || '').toLowerCase();
    const description = context.description.toLowerCase();

    // Simple keyword matching
    const keywords = description.split(/\s+/);
    const matchedKeywords = keywords.filter((kw) => ruleText.includes(kw));

    if (matchedKeywords.length > 0) {
      confidence += matchedKeywords.length * 0.1;
    }

    // Cap confidence
    confidence = Math.min(confidence, 0.95);

    if (confidence < 0.5) {
      return null;
    }

    return {
      ruleId: rule.id,
      category: this.mapRuleCategoryToClassification(rule.category),
      deductibility: this.determineDeductibility(rule),
      confidence,
      citations: [{
        section: rule.section?.sectionNumber || '',
        text: rule.summary,
      }],
    };
  }

  private mapRuleCategoryToClassification(ruleCategory: string): ClassificationCategory {
    const mapping: Record<string, ClassificationCategory> = {
      income: ClassificationCategory.ORDINARY_INCOME,
      gross_receipts: ClassificationCategory.ORDINARY_INCOME,
      deduction: ClassificationCategory.BUSINESS_EXPENSE_ORDINARY,
      expense: ClassificationCategory.BUSINESS_EXPENSE_ORDINARY,
      depreciation: ClassificationCategory.DEPRECIATION_EXPENSE,
      interest: ClassificationCategory.INTEREST_EXPENSE_BUSINESS,
      charitable: ClassificationCategory.CHARITABLE_CONTRIBUTION,
    };

    return mapping[ruleCategory] || ClassificationCategory.UNCLASSIFIED;
  }

  private determineDeductibility(rule: any): DeductibilityStatus {
    // Analyze rule to determine deductibility
    const ruleText = (rule.ruleText || '').toLowerCase();

    if (ruleText.includes('not deductible') || ruleText.includes('nondeductible')) {
      return DeductibilityStatus.NON_DEDUCTIBLE;
    }
    if (ruleText.includes('limited') || ruleText.includes('50%') || ruleText.includes('partial')) {
      return DeductibilityStatus.PARTIALLY_DEDUCTIBLE;
    }
    if (ruleText.includes('capitalize') || ruleText.includes('capitalized')) {
      return DeductibilityStatus.CAPITALIZED;
    }

    return DeductibilityStatus.FULLY_DEDUCTIBLE;
  }

  private isLimitationApplicable(
    limitation: any,
    category: ClassificationCategory,
    context: TransactionContext,
  ): boolean {
    // Check if limitation applies to this category
    const limitDesc = (limitation.description || '').toLowerCase();
    const categoryLower = category.toLowerCase();

    return limitDesc.includes(categoryLower) ||
           (category === ClassificationCategory.MEALS_ENTERTAINMENT && limitDesc.includes('meal')) ||
           (category === ClassificationCategory.CHARITABLE_CONTRIBUTION && limitDesc.includes('charitable'));
  }

  private isExceptionApplicable(
    exception: any,
    category: ClassificationCategory,
    context: TransactionContext,
  ): boolean {
    // Check if exception applies
    return false; // Simplified for now
  }

  private async checkSection179Eligibility(context: TransactionContext): Promise<boolean> {
    // Check if asset qualifies for Section 179
    const description = context.description.toLowerCase();
    const eligibleTypes = ['equipment', 'machinery', 'computer', 'furniture', 'vehicle'];

    return eligibleTypes.some((type) => description.includes(type));
  }

  private async checkBonusDepreciationEligibility(context: TransactionContext): Promise<boolean> {
    // Check if asset qualifies for bonus depreciation
    // Most new property qualifies for bonus depreciation
    return true;
  }

  private async checkRelatedPartyRules(context: TransactionContext): Promise<boolean> {
    // Check if transaction might be with related party
    const description = context.description.toLowerCase();
    const relatedIndicators = ['shareholder', 'owner', 'related', 'family', 'controlled'];

    return relatedIndicators.some((ind) => description.includes(ind));
  }
}
