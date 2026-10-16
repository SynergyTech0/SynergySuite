import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClassificationCategory, TaxCitationDto } from '../dto/tax-classification.dto';

@Injectable()
export class CitationGenerator {
  private readonly logger = new Logger(CitationGenerator.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateCitations(
    category: ClassificationCategory,
    context: {
      description: string;
      amount: number;
      entityType?: string;
    },
  ): Promise<TaxCitationDto[]> {
    const citations: TaxCitationDto[] = [];

    // Get primary citations based on category
    const primaryCitations = await this.getPrimaryCitations(category);
    citations.push(...primaryCitations);

    // Get supporting citations from knowledge graph
    const supportingCitations = await this.getSupportingCitations(category, context);
    citations.push(...supportingCitations);

    // Get relevant court cases
    const courtCitations = await this.getCourtCitations(category);
    citations.push(...courtCitations);

    // Sort by relevance and limit
    return citations
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 5);
  }

  async getPrimaryCitations(category: ClassificationCategory): Promise<TaxCitationDto[]> {
    // Map categories to primary IRC sections
    const primarySections: Record<ClassificationCategory, TaxCitationDto[]> = {
      [ClassificationCategory.ORDINARY_INCOME]: [{
        section: 'IRC § 61(a)',
        text: 'Gross income includes all income from whatever source derived',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.BUSINESS_EXPENSE_ORDINARY]: [{
        section: 'IRC § 162(a)',
        text: 'All ordinary and necessary expenses paid or incurred during the taxable year in carrying on any trade or business',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.BUSINESS_EXPENSE_NECESSARY]: [{
        section: 'IRC § 162(a)',
        text: 'Ordinary and necessary business expenses are deductible',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.DEPRECIATION_EXPENSE]: [{
        section: 'IRC § 167(a)',
        text: 'Reasonable allowance for exhaustion, wear and tear of property used in trade or business',
        relevanceScore: 0.95,
      }, {
        section: 'IRC § 168',
        text: 'Accelerated cost recovery system for tangible property',
        relevanceScore: 0.90,
      }],
      [ClassificationCategory.SECTION_179]: [{
        section: 'IRC § 179',
        text: 'Election to expense certain depreciable business assets',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.BONUS_DEPRECIATION]: [{
        section: 'IRC § 168(k)',
        text: 'Special depreciation allowance for qualified property',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.INTEREST_EXPENSE_BUSINESS]: [{
        section: 'IRC § 163(a)',
        text: 'General rule allowing deduction for interest paid on indebtedness',
        relevanceScore: 0.95,
      }, {
        section: 'IRC § 163(j)',
        text: 'Business interest limitation',
        relevanceScore: 0.85,
      }],
      [ClassificationCategory.MEALS_ENTERTAINMENT]: [{
        section: 'IRC § 274(a)',
        text: 'Disallowance of certain entertainment expenses',
        relevanceScore: 0.95,
      }, {
        section: 'IRC § 274(n)',
        text: 'Only 50% of meal expenses generally deductible',
        relevanceScore: 0.90,
      }],
      [ClassificationCategory.TRAVEL_EXPENSE]: [{
        section: 'IRC § 162(a)(2)',
        text: 'Travel expenses while away from home in pursuit of trade or business',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.CHARITABLE_CONTRIBUTION]: [{
        section: 'IRC § 170(a)',
        text: 'Deduction for charitable contributions',
        relevanceScore: 0.95,
      }, {
        section: 'IRC § 170(b)(2)',
        text: 'Corporate charitable contribution limited to 10% of taxable income',
        relevanceScore: 0.88,
      }],
      [ClassificationCategory.HOME_OFFICE]: [{
        section: 'IRC § 280A',
        text: 'Disallowance of certain expenses in connection with business use of home',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.VEHICLE_EXPENSE]: [{
        section: 'IRC § 280F',
        text: 'Limitation on depreciation for luxury automobiles',
        relevanceScore: 0.90,
      }, {
        section: 'IRC § 162(a)',
        text: 'Business use of vehicle as ordinary and necessary expense',
        relevanceScore: 0.85,
      }],
      [ClassificationCategory.CAPITAL_GAIN_LONG]: [{
        section: 'IRC § 1(h)',
        text: 'Maximum capital gains rate',
        relevanceScore: 0.95,
      }, {
        section: 'IRC § 1222',
        text: 'Definition of long-term capital gain',
        relevanceScore: 0.90,
      }],
      [ClassificationCategory.CAPITAL_GAIN_SHORT]: [{
        section: 'IRC § 1222',
        text: 'Definition of short-term capital gain',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.COGS]: [{
        section: 'IRC § 263A',
        text: 'Capitalization and inclusion in inventory costs of certain expenses',
        relevanceScore: 0.90,
      }, {
        section: 'Treas. Reg. § 1.471-3',
        text: 'Inventories at cost',
        relevanceScore: 0.85,
      }],
      [ClassificationCategory.NON_DEDUCTIBLE]: [{
        section: 'IRC § 262',
        text: 'Personal, living, and family expenses are not deductible',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.CAPITAL_EXPENDITURE]: [{
        section: 'IRC § 263(a)',
        text: 'Capital expenditures must be capitalized, not deducted',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.RETIREMENT_CONTRIBUTION]: [{
        section: 'IRC § 404',
        text: 'Deduction for contributions to qualified plans',
        relevanceScore: 0.95,
      }],
      [ClassificationCategory.HEALTH_INSURANCE]: [{
        section: 'IRC § 162(l)',
        text: 'Deduction for health insurance costs of self-employed individuals',
        relevanceScore: 0.90,
      }],
      [ClassificationCategory.PAYROLL_TAX]: [{
        section: 'IRC § 3111',
        text: 'Employer FICA taxes',
        relevanceScore: 0.90,
      }],
    } as any;

    return primarySections[category] || [];
  }

  private async getSupportingCitations(
    category: ClassificationCategory,
    context: any,
  ): Promise<TaxCitationDto[]> {
    // Query knowledge graph for relevant cross-references
    const crossRefs = await this.prisma.taxCrossReference.findMany({
      where: {
        referenceType: { in: ['RELATED', 'EXCEPTION', 'LIMITATION'] },
      },
      include: {
        sourceSection: true,
        targetSection: true,
      },
      take: 5,
    });

    return crossRefs.map((ref) => ({
      section: ref.targetSection?.sectionNumber || '',
      text: ref.context || '',
      relevanceScore: 0.7,
    }));
  }

  private async getCourtCitations(category: ClassificationCategory): Promise<TaxCitationDto[]> {
    // Query for relevant tax court cases
    const cases: Record<ClassificationCategory, TaxCitationDto[]> = {
      [ClassificationCategory.BUSINESS_EXPENSE_ORDINARY]: [{
        section: 'IRC § 162',
        courtCase: 'Welch v. Helvering, 290 U.S. 111 (1933)',
        text: 'Expense must be ordinary and necessary - helpful and appropriate for business',
        relevanceScore: 0.85,
      }, {
        section: 'IRC § 162',
        courtCase: 'Deputy v. du Pont, 308 U.S. 488 (1940)',
        text: 'Ordinary means normal, usual, or customary in the particular business',
        relevanceScore: 0.80,
      }],
      [ClassificationCategory.TRAVEL_EXPENSE]: [{
        section: 'IRC § 162(a)(2)',
        courtCase: 'Commissioner v. Flowers, 326 U.S. 465 (1946)',
        text: 'Travel expenses must be incurred while away from home in pursuit of business',
        relevanceScore: 0.85,
      }],
      [ClassificationCategory.HOME_OFFICE]: [{
        section: 'IRC § 280A',
        courtCase: 'Commissioner v. Soliman, 506 U.S. 168 (1993)',
        text: 'Home office must be principal place of business based on relative importance and time spent',
        relevanceScore: 0.85,
      }],
    } as any;

    return cases[category] || [];
  }

  async formatCitation(citation: TaxCitationDto): Promise<string> {
    let formatted = citation.section;

    if (citation.regulation) {
      formatted += `; ${citation.regulation}`;
    }

    if (citation.courtCase) {
      formatted += ` (see ${citation.courtCase})`;
    }

    if (citation.publication) {
      formatted += `; ${citation.publication}`;
    }

    return formatted;
  }

  async generateCitationReport(
    citations: TaxCitationDto[],
  ): Promise<string> {
    const lines: string[] = [
      'TAX AUTHORITY CITATIONS',
      '=' .repeat(50),
      '',
    ];

    // Group by source type
    const ircCitations = citations.filter((c) => c.section.startsWith('IRC'));
    const regCitations = citations.filter((c) => c.regulation);
    const caseCitations = citations.filter((c) => c.courtCase);

    if (ircCitations.length > 0) {
      lines.push('Internal Revenue Code:');
      ircCitations.forEach((c) => {
        lines.push(`  • ${c.section}`);
        if (c.text) lines.push(`    "${c.text}"`);
      });
      lines.push('');
    }

    if (regCitations.length > 0) {
      lines.push('Treasury Regulations:');
      regCitations.forEach((c) => {
        lines.push(`  • ${c.regulation}`);
        if (c.text) lines.push(`    "${c.text}"`);
      });
      lines.push('');
    }

    if (caseCitations.length > 0) {
      lines.push('Relevant Case Law:');
      caseCitations.forEach((c) => {
        lines.push(`  • ${c.courtCase}`);
        if (c.text) lines.push(`    "${c.text}"`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }
}
