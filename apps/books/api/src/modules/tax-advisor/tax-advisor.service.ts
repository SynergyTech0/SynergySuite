import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class TaxAdvisorService {
  private readonly logger = new Logger(TaxAdvisorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyzeTaxOpportunities(organizationId: string, fiscalYear: number, state?: string) {
    // Fetch financial data for analysis
    const transactions = await this.prisma.journal.findMany({
      where: {
        organizationId,
        journalDate: {
          gte: new Date(`${fiscalYear}-01-01`),
          lte: new Date(`${fiscalYear}-12-31`),
        },
      },
      include: { lines: { include: { account: true } } },
    });

    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId,
        expenseDate: {
          gte: new Date(`${fiscalYear}-01-01`),
          lte: new Date(`${fiscalYear}-12-31`),
        },
      },
    });

    const opportunities: any[] = [];

    // Analyze for common tax optimization opportunities
    opportunities.push(...this.analyzeDeductions(expenses, transactions));
    opportunities.push(...this.analyzeTaxCredits(organizationId, fiscalYear));
    opportunities.push(...this.analyzeDeferralStrategies(transactions));
    opportunities.push(...this.analyzeStateIncentives(state));

    // Sort by estimated savings
    opportunities.sort((a, b) => (b.estimatedSavings || 0) - (a.estimatedSavings || 0));

    return {
      organizationId,
      fiscalYear,
      state,
      totalOpportunities: opportunities.length,
      estimatedTotalSavings: opportunities.reduce((sum, o) => sum + (o.estimatedSavings || 0), 0),
      opportunities,
    };
  }

  private analyzeDeductions(expenses: any[], transactions: any[]): any[] {
    const opportunities = [];

    // Analyze meal and entertainment deductions (50% deductible)
    const mealExpenses = expenses.filter((e) => e.category === 'MEALS');
    if (mealExpenses.length > 0) {
      const totalMeals = mealExpenses.reduce((sum, e) => sum + e.amount, 0);
      opportunities.push({
        id: uuidv4(),
        opportunityType: 'DEDUCTION',
        title: 'Meal & Entertainment Deductions',
        description: `You have $${totalMeals.toFixed(2)} in meal expenses. 50% is deductible. Ensure documentation for business purpose.`,
        estimatedSavings: (totalMeals * 0.5) * 0.21,
        riskLevel: 'LOW',
        jurisdiction: 'Federal',
        priority: 7,
      });
    }

    // Analyze office supplies (fully deductible)
    const supplies = expenses.filter((e) => e.category === 'SUPPLIES');
    if (supplies.length > 0) {
      const totalSupplies = supplies.reduce((sum, e) => sum + e.amount, 0);
      opportunities.push({
        id: uuidv4(),
        opportunityType: 'DEDUCTION',
        title: 'Office Supply Deductions',
        description: `Ensure all office supplies ($${totalSupplies.toFixed(2)}) are properly documented and expensed.`,
        estimatedSavings: totalSupplies * 0.21,
        riskLevel: 'LOW',
        jurisdiction: 'Federal',
        priority: 8,
      });
    }

    // Analyze travel deductions
    const travel = expenses.filter((e) => e.category === 'TRAVEL');
    if (travel.length > 0) {
      const totalTravel = travel.reduce((sum, e) => sum + e.amount, 0);
      opportunities.push({
        id: uuidv4(),
        opportunityType: 'DEDUCTION',
        title: 'Business Travel Deductions',
        description: `Business travel expenses ($${totalTravel.toFixed(2)}) are deductible if properly documented with business purpose.`,
        estimatedSavings: totalTravel * 0.21,
        riskLevel: 'MEDIUM',
        jurisdiction: 'Federal',
        priority: 8,
      });
    }

    return opportunities;
  }

  private analyzeTaxCredits(organizationId: string, fiscalYear: number): any[] {
    const opportunities = [];

    opportunities.push({
      id: uuidv4(),
      opportunityType: 'CREDIT',
      title: 'Research & Development Tax Credit',
      description: `R&D tax credits up to 20% of qualifying expenses for new software, processes, or improvements.`,
      estimatedSavings: 5000,
      riskLevel: 'MEDIUM',
      jurisdiction: 'Federal',
      priority: 9,
    });

    opportunities.push({
      id: uuidv4(),
      opportunityType: 'CREDIT',
      title: 'Work Opportunity Tax Credit (WOTC)',
      description: `$2,400-$9,600 per employee hired from targeted groups (veterans, youth, long-term unemployed).`,
      estimatedSavings: 4800,
      riskLevel: 'LOW',
      jurisdiction: 'Federal',
      priority: 7,
    });

    opportunities.push({
      id: uuidv4(),
      opportunityType: 'CREDIT',
      title: 'Energy Efficient Property Credits',
      description: `30% investment credit for qualified energy-efficient HVAC, lighting, or solar equipment.`,
      estimatedSavings: 3000,
      riskLevel: 'LOW',
      jurisdiction: 'Federal',
      priority: 6,
    });

    return opportunities;
  }

  private analyzeDeferralStrategies(transactions: any[]): any[] {
    const opportunities = [];

    opportunities.push({
      id: uuidv4(),
      opportunityType: 'DEFERRAL',
      title: 'S-Corp Election Strategy',
      description: `Reduce self-employment taxes by electing S-Corp status with reasonable W-2 wages and distributions.`,
      estimatedSavings: 5000,
      riskLevel: 'MEDIUM',
      jurisdiction: 'Federal',
      priority: 9,
    });

    opportunities.push({
      id: uuidv4(),
      opportunityType: 'DEFERRAL',
      title: 'Qualified Opportunity Zone Investment',
      description: `Defer capital gains taxes and potentially exclude gains entirely via QOZ investments.`,
      estimatedSavings: 10000,
      riskLevel: 'HIGH',
      jurisdiction: 'Federal',
      priority: 8,
    });

    opportunities.push({
      id: uuidv4(),
      opportunityType: 'DEFERRAL',
      title: 'Installment Sale Strategy',
      description: `Spread asset sale gains over multiple years to reduce current year tax burden.`,
      estimatedSavings: 3000,
      riskLevel: 'LOW',
      jurisdiction: 'Federal',
      priority: 7,
    });

    return opportunities;
  }

  private analyzeStateIncentives(state?: string): any[] {
    const opportunities: Record<string, unknown>[] = [];

    const stateIncentives: Record<string, any[]> = {
      CA: [
        {
          title: 'California New Markets Tax Credit',
          description: 'Invest in disadvantaged communities for 5% annual credit over 7 years.',
          estimatedSavings: 2500,
        },
      ],
      NY: [
        {
          title: 'NY Empire Zone Benefits',
          description: 'Manufacturing businesses may qualify for property and sales tax credits.',
          estimatedSavings: 3000,
        },
      ],
      TX: [
        {
          title: 'Texas Research Tax Credit',
          description: 'Businesses conducting R&D in Texas qualify for 5% credit on qualifying expenses.',
          estimatedSavings: 4000,
        },
      ],
    };

    if (state && stateIncentives[state]) {
      return stateIncentives[state].map((incentive) => ({
        id: uuidv4(),
        opportunityType: 'CREDIT',
        jurisdiction: state,
        priority: 6,
        riskLevel: 'LOW',
        ...incentive,
      }));
    }

    return opportunities;
  }

  async getTaxCompliance(organizationId: string, fiscalYear: number): Promise<any> {
    const requirements = [];

    requirements.push({
      requirement: 'Form 1120 (Corporate Return)',
      dueDate: new Date(fiscalYear + 1, 3, 15),
      description: 'Annual corporate tax return',
      priority: 'CRITICAL',
    });

    requirements.push({
      requirement: 'Payroll Tax Returns (941/940)',
      dueDate: new Date(fiscalYear + 1, 0, 31),
      description: 'Quarterly and annual payroll tax reporting',
      priority: 'CRITICAL',
    });

    requirements.push({
      requirement: 'Sales Tax Returns',
      dueDate: new Date(fiscalYear + 1, 1, 28),
      description: 'Sales and use tax reporting',
      priority: 'CRITICAL',
    });

    requirements.push({
      requirement: 'W-2 & 1099 Forms',
      dueDate: new Date(fiscalYear + 1, 0, 31),
      description: 'Employee and contractor reporting',
      priority: 'CRITICAL',
    });

    return {
      organizationId,
      fiscalYear,
      requirements,
      complianceScore: 85,
    };
  }

  async askTaxQuestion(organizationId: string, question: string): Promise<any> {
    const answer = await this.generateTaxAnswer(question, organizationId);
    const category = this.categorizeTaxQuestion(question);

    return {
      question,
      answer,
      category,
      timestamp: new Date(),
    };
  }

  private categorizeTaxQuestion(question: string): string {
    const keywords = {
      DEDUCTION: ['deduct', 'expense', 'deductible'],
      CREDIT: ['credit', 'claim'],
      ENTITY: ['s-corp', 'llc', 'structure', 'entity'],
      COMPLIANCE: ['deadline', 'filing', 'requirement', 'return'],
      RETIREMENT: ['401k', 'sep', 'solo 401k', 'retirement'],
    };

    for (const [category, words] of Object.entries(keywords)) {
      if (words.some((w) => question.toLowerCase().includes(w))) {
        return category;
      }
    }

    return 'GENERAL';
  }

  private async generateTaxAnswer(question: string, organizationId: string): Promise<string> {
    // Placeholder for LLM integration
    return `[AI Tax Advisor] ${question}\n\nThis answer is based on current IRS guidelines. Please consult a tax professional for specific situations.`;
  }
}
