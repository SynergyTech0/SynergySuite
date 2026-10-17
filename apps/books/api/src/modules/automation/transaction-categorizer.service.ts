import { chat, loadAiConfig } from '@synergy/ai';
import { Injectable, Logger } from '@nestjs/common';
import { ExpenseCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Map a free-text category name returned by the AI model onto the
 * ExpenseCategory enum stored on Expense. Returns null when the model could
 * not categorize the transaction, so callers leave the expense uncategorized.
 */
export function toExpenseCategory(category: string): ExpenseCategory | null {
  const normalized = category.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!normalized || normalized === 'UNCATEGORIZED') return null;
  if ((Object.values(ExpenseCategory) as string[]).includes(normalized)) {
    return normalized as ExpenseCategory;
  }
  const rules: Array<[RegExp, ExpenseCategory]> = [
    [/RENT/, ExpenseCategory.OFFICE_RENT],
    [/UTILIT/, ExpenseCategory.UTILITIES],
    [/SUPPL/, ExpenseCategory.SUPPLIES],
    [/PROFESSIONAL|LEGAL|ACCOUNTING|CONSULT/, ExpenseCategory.PROFESSIONAL_FEES],
    [/TRAVEL/, ExpenseCategory.TRAVEL],
    [/MEAL/, ExpenseCategory.MEALS],
    [/ENTERTAIN/, ExpenseCategory.ENTERTAINMENT],
    [/EQUIPMENT|DEPRECIATION/, ExpenseCategory.EQUIPMENT],
    [/REPAIR|MAINTENANCE/, ExpenseCategory.MAINTENANCE],
    [/VEHICLE|TRANSPORT|FUEL/, ExpenseCategory.TRANSPORTATION],
    [/TELECOM|PHONE|INTERNET/, ExpenseCategory.TELECOMMUNICATIONS],
  ];
  for (const [pattern, value] of rules) {
    if (pattern.test(normalized)) return value;
  }
  return ExpenseCategory.OTHER;
}

interface TransactionData {
  id: string;
  description: string;
  amount: number;
  vendor?: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  organizationId: string;
}

interface CategorizationResult {
  category: string;
  subcategory?: string;
  confidence: number;
  reasoning: string;
  suggestedGLAccount?: string;
}

@Injectable()
export class TransactionCategorizerService {
  private readonly logger = new Logger(TransactionCategorizerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Categorize transaction using Ollama
   */
  async categorizeTransaction(transaction: TransactionData): Promise<CategorizationResult> {
    try {
      const prompt = this.buildCategorizationPrompt(transaction);
      const response = await this.callModel(prompt);
      const result = this.parseCategorizationResponse(response);

      return result;
    } catch (error) {
      this.logger.error(`Failed to categorize transaction ${transaction.id}:`, error);
      return {
        category: 'UNCATEGORIZED',
        confidence: 0,
        reasoning: 'AI categorization failed, manual review required',
      };
    }
  }

  /**
   * Build structured prompt for Ollama
   */
  private buildCategorizationPrompt(transaction: TransactionData): string {
    return `You are an accounting categorization expert. Categorize this transaction into the most appropriate accounting category.

Transaction Details:
- Description: ${transaction.description}
- Vendor/Payee: ${transaction.vendor || 'Unknown'}
- Amount: $${transaction.amount}
- Type: ${transaction.type}

Available Expense Categories:
1. Salaries & Wages - Employee salaries, wages, bonuses
2. Office Rent - Rent for office space, facilities
3. Utilities - Electricity, water, internet, phone
4. Office Supplies - Stationery, ink, paper, equipment under $500
5. Professional Services - Legal, accounting, consulting fees
6. Insurance - Business liability, health, property insurance
7. Travel & Meals - Flights, hotels, meals for business (50% deductible)
8. Marketing & Advertising - Ads, promotions, social media
9. Software & Subscriptions - SaaS tools, licenses, subscriptions
10. Equipment & Depreciation - Machinery, vehicles, furniture over $500
11. Inventory - Raw materials, resale products
12. COGS - Cost of goods sold
13. Repairs & Maintenance - Building repairs, equipment maintenance
14. Vehicle Expenses - Fuel, maintenance, insurance (if not capitalized)
15. Bank Fees & Interest - Finance charges, transfer fees
16. Miscellaneous - Other business expenses

Revenue Categories:
1. Product Sales - Revenue from selling products
2. Service Revenue - Revenue from services provided
3. Consulting Revenue - Revenue from consulting work
4. Investment Income - Dividends, interest, capital gains
5. Other Income - Grants, refunds, misc income

Respond ONLY in valid JSON format (no other text):
{
  "category": "Category Name",
  "subcategory": "Specific type if applicable",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this category",
  "suggestedGLAccount": "5000 - Category Name (example)"
}`;
  }

  /**
   * Ask the configured AI model (suite AI_* settings, overridable with BOOKS_AI_*).
   */
  private async callModel(prompt: string): Promise<string> {
    try {
      return await chat({ prompt, temperature: 0.2, config: await loadAiConfig({ prefix: 'BOOKS_' }) });
    } catch (error) {
      this.logger.error('AI call failed:', error);
      throw error;
    }
  }

  /**
   * Parse the model's JSON response
   */
  private parseCategorizationResponse(response: string): CategorizationResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        category: parsed.category || 'UNCATEGORIZED',
        subcategory: parsed.subcategory,
        confidence: Math.min(Math.max(parsed.confidence || 0, 0), 1),
        reasoning: parsed.reasoning || '',
        suggestedGLAccount: parsed.suggestedGLAccount,
      };
    } catch (error) {
      this.logger.error('Failed to parse categorization response:', error);
      throw error;
    }
  }

  /**
   * Batch categorize uncategorized transactions
   */
  async categorizeUncategorizedTransactions(organizationId: string): Promise<number> {
    const uncategorized = await this.prisma.expense.findMany({
      where: {
        organizationId,
        category: null,
      },
      take: 100,
    });

    let count = 0;
    for (const expense of uncategorized) {
      try {
        const result = await this.categorizeTransaction({
          id: expense.id,
          description: expense.description || '',
          amount: expense.amount.toNumber(),
          type: 'EXPENSE',
          organizationId,
        });

        // Update expense with category
        const category = toExpenseCategory(result.category);
        if (result.confidence > 0.7 && category) {
          await this.prisma.expense.update({
            where: { id: expense.id },
            data: {
              category,
              description: `${expense.description} [${result.category}]`,
            },
          });
          count++;
        }
      } catch (error) {
        this.logger.warn(`Could not categorize expense ${expense.id}:`, (error as Error).message);
      }
    }

    return count;
  }

  /**
   * Get suggested categories for UI
   */
  async getSuggestedCategory(description: string): Promise<CategorizationResult> {
    const transaction: TransactionData = {
      id: `temp-${Date.now()}`,
      description,
      amount: 0,
      type: 'EXPENSE',
      organizationId: 'temp',
    };

    return this.categorizeTransaction(transaction);
  }
}
