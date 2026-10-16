import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { aiConfig, chat, isAiConfigured } from '@synergy/ai';
import { PrismaService } from '../../prisma/prisma.service';

// Bring your own model: the suite-wide AI_* settings, overridable with BOOKS_AI_*.
const AI = { prefix: 'BOOKS_' };

type Section = { sectionNumber: string; sectionTitle: string | null; content: string };

/**
 * Live tax intelligence: retrieves the most relevant Internal Revenue Code
 * sections from the KB (full-text) and has the configured AI model reason over them — grounded,
 * with § citations — for deductibility / write-off questions.
 */
@Injectable()
export class TaxAiService {
  private readonly logger = new Logger(TaxAiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Full-text retrieve top-K IRC sections for a query. */
  async retrieve(query: string, topK = 6): Promise<Section[]> {
    const q = (query || '').trim();
    if (!q) return [];
    return this.prisma.$queryRawUnsafe<Section[]>(
      `SELECT "sectionNumber", "sectionTitle", content
       FROM "TaxSection"
       WHERE "documentId" = 'ircdoc_t26'
         AND to_tsvector('english', coalesce("sectionTitle",'') || ' ' || content) @@ plainto_tsquery('english', $1)
       ORDER BY ts_rank(to_tsvector('english', coalesce("sectionTitle",'') || ' ' || content), plainto_tsquery('english', $1)) DESC
       LIMIT $2`,
      q,
      topK,
    );
  }

  private async callModel(system: string, user: string, maxTokens = 1200): Promise<string> {
    if (!isAiConfigured(AI)) throw new ServiceUnavailableException('Tax AI is off: no AI model is configured.');
    try {
      return await chat({ system, prompt: user, maxTokens, config: aiConfig(AI) });
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`AI call failed: ${msg}`);
      // Surface credit/config problems as a clean 503 the UI can show.
      throw new ServiceUnavailableException(`Tax AI unavailable: ${msg}`);
    }
  }

  private context(sections: Section[]): string {
    return sections
      .map((s) => `26 U.S.C. § ${s.sectionNumber} — ${s.sectionTitle || ''}\n${s.content.slice(0, 6000)}`)
      .join('\n\n---\n\n');
  }

  private readonly SYSTEM =
    'You are a meticulous U.S. tax advisor for a small business. Answer ONLY from the Internal Revenue Code ' +
    'sections provided. Cite the specific § you rely on (e.g. "§162(a)"). Be precise and practical about ' +
    'deductibility, limits, and substantiation. If the provided sections do not settle the question, say what ' +
    'is uncertain and which section or guidance would resolve it. Never invent code sections or dollar figures. ' +
    'Keep it concise and actionable. This is general information, not formal tax advice.';

  /** Free-form tax question grounded in the IRC. */
  async ask(question: string) {
    if (!question?.trim()) throw new BadRequestException('Ask a question.');
    const sections = await this.retrieve(question);
    const answer = await this.callModel(
      this.SYSTEM,
      `Question: ${question}\n\nRelevant Internal Revenue Code sections:\n\n${this.context(sections)}`,
    );
    return { answer, citations: sections.map((s) => ({ section: s.sectionNumber, title: s.sectionTitle })) };
  }

  /** Deductibility analysis for a specific expense/transaction. */
  async analyze(description: string, amount?: number, category?: string) {
    if (!description?.trim()) throw new BadRequestException('Provide an expense description.');
    const query = [description, category].filter(Boolean).join(' ');
    const sections = await this.retrieve(query);
    const user =
      `Analyze this business expense for federal income-tax deductibility.\n` +
      `Expense: ${description}\n` +
      (amount != null ? `Amount: $${amount}\n` : '') +
      (category ? `Booked category: ${category}\n` : '') +
      `\nTell me: (1) is it deductible and under which § ; (2) any limit/percentage or special rule (e.g. §274 meals 50%, §280F luxury auto, §179/§168 depreciation) ; (3) substantiation needed. Be specific.\n\n` +
      `Relevant Internal Revenue Code sections:\n\n${this.context(sections)}`;
    const answer = await this.callModel(this.SYSTEM, user);
    return { answer, citations: sections.map((s) => ({ section: s.sectionNumber, title: s.sectionTitle })) };
  }

  /** Corpus status for the UI. */
  async status() {
    const rows = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint as count FROM "TaxSection" WHERE "documentId" = 'ircdoc_t26'`,
    );
    return { ircSections: Number(rows?.[0]?.count ?? 0), model: aiConfig(AI)?.model ?? null, configured: isAiConfigured(AI) };
  }
}
