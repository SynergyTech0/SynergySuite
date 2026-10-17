import { Injectable, Logger } from '@nestjs/common';
import { chat, isAiAvailable, loadAiConfig } from '@synergy/ai';
import { PrismaService } from '../../prisma/prisma.service';

// Bring your own model: the suite-wide AI_* settings, overridable with BOOKS_AI_*.
const AI = { prefix: 'BOOKS_' };

type Cat = { num: string; name: string; type: 'EXPENSE' | 'REVENUE'; normal: 'DEBIT' | 'CREDIT' };

// A real small-business chart of accounts. Ensured to exist so categorization
// (and the review-page dropdown) has dozens of meaningful buckets, not one
// "Operating Expenses" catch-all. Numbers follow standard ranges:
//   4xxx revenue · 5xxx COGS(expense) · 6xxx operating expense
const CATEGORIES: Cat[] = [
  // Revenue
  { num: '4010', name: 'Service Revenue', type: 'REVENUE', normal: 'CREDIT' },
  { num: '4020', name: 'Product Sales', type: 'REVENUE', normal: 'CREDIT' },
  { num: '4030', name: 'Consulting Income', type: 'REVENUE', normal: 'CREDIT' },
  { num: '4040', name: 'Interest Income', type: 'REVENUE', normal: 'CREDIT' },
  { num: '4050', name: 'Refunds & Reimbursements', type: 'REVENUE', normal: 'CREDIT' },
  { num: '4900', name: 'Other Income', type: 'REVENUE', normal: 'CREDIT' },
  // Cost of goods sold
  { num: '5010', name: 'Merchant Processing Fees (COGS)', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '5020', name: 'Subcontracted Services', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '5030', name: 'Job Materials & Supplies', type: 'EXPENSE', normal: 'DEBIT' },
  // Operating expenses
  { num: '6010', name: 'Software & Subscriptions', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6011', name: 'Cloud Infrastructure & Hosting', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6012', name: 'AI & Data Services', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6020', name: 'Meals & Entertainment', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6030', name: 'Travel', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6031', name: 'Airfare', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6032', name: 'Lodging', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6033', name: 'Ground Transportation & Rideshare', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6040', name: 'Office Supplies', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6041', name: 'Postage & Shipping', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6042', name: 'Printing & Reproduction', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6050', name: 'Bank & Merchant Fees', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6051', name: 'Interest Expense', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6060', name: 'Rent & Lease', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6061', name: 'Equipment & Hardware', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6062', name: 'Repairs & Maintenance', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6070', name: 'Contractors & Freelancers', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6071', name: 'Payroll — Wages', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6072', name: 'Payroll Taxes', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6073', name: 'Employee Benefits', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6080', name: 'Advertising & Marketing', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6081', name: 'Website & Domains', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6090', name: 'Utilities', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6091', name: 'Telephone & Internet', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6100', name: 'Insurance', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6110', name: 'Legal & Professional Fees', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6111', name: 'Accounting & Bookkeeping', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6120', name: 'Dues & Memberships', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6130', name: 'Training & Education', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6140', name: 'Taxes & Licenses', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6150', name: 'Charitable Contributions', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6160', name: 'Vehicle & Fuel', type: 'EXPENSE', normal: 'DEBIT' },
  { num: '6900', name: 'Miscellaneous Expense', type: 'EXPENSE', normal: 'DEBIT' },
];

// keyword → category account number. First match wins, so order most-specific first.
const RULES: [RegExp, string][] = [
  // AI / data
  [/\b(anthropic|openai|cohere|huggingface|hugging face|pinecone|weights ?& ?biases|scale ai|replicate)\b/i, '6012'],
  // Cloud infra / hosting
  [/\b(aws|amazon web|ec2|s3 |google cloud|gcp|digitalocean|linode|vultr|hetzner|cloudflare|fastly|heroku|render\.com|fly\.io|netlify|vercel)\b/i, '6011'],
  // Website & domains
  [/\b(godaddy|namecheap|name\.com|hover|domain|dnsimple|squarespace|wix|webflow)\b/i, '6081'],
  // Software & subscriptions
  [/\b(microsoft|msft|office ?365|adobe|github|gitlab|atlassian|jira|notion|slack|zoom|dropbox|figma|canva|hubspot|salesforce|quickbooks|intuit|1password|lastpass|zendesk|docusign|calendly|monday\.com|asana|linear|airtable|zapier|twilio|sendgrid|mailgun|stripe billing|apple\.com\/bill|google \*)\b/i, '6010'],
  // Advertising & marketing
  [/\b(facebook|meta ads|google ads|adwords|instagram ads|linkedin ads|tiktok ads|mailchimp|constant contact|klaviyo|hootsuite|buffer|advertis|sponsored)\b/i, '6080'],
  // Airfare
  [/\b(airline|air ?lines|delta air|united air|american air|southwest|jetblue|alaska air|spirit air|frontier air|expedia|kayak)\b/i, '6031'],
  // Lodging
  [/\b(hotel|airbnb|vrbo|marriott|hilton|hyatt|holiday inn|best western|motel|lodging|resort)\b/i, '6032'],
  // Ground transport / rideshare
  [/\b(uber|lyft|taxi|hertz|avis|enterprise rent|budget rent|zipcar|parking|toll|metro|transit|amtrak)\b/i, '6033'],
  // Meals
  [/\b(restaurant|cafe|coffee|starbucks|dunkin|doordash|uber ?eats|grubhub|postmates|seamless|dinner|lunch|pizza|grill|kitchen|taco|sushi|chipotle|mcdonald|panera|deli|bakery|bar & grill|brewery)\b/i, '6020'],
  // Vehicle & fuel
  [/\b(shell|chevron|exxon|mobil|bp |arco|valero|marathon|speedway|gas station|fuel|auto ?zone|jiffy lube|car wash)\b/i, '6160'],
  // Office supplies / general retail
  [/\b(staples|office depot|officemax|amzn|amazon\.com|amazon mktp|costco|walmart|target|best buy|home depot|lowe'?s|uline)\b/i, '6040'],
  // Postage & shipping
  [/\b(usps|ups |fedex|dhl|stamps\.com|pitney bowes|shippo|postage)\b/i, '6041'],
  // Payroll / contractors
  [/\b(gusto|adp|paychex|rippling|justworks|payroll|deel|remote\.com)\b/i, '6071'],
  [/\b(upwork|fiverr|toptal|contractor|1099|freelance|venmo|cash ?app)\b/i, '6070'],
  // Bank & merchant fees
  [/\b(fee|service charge|overdraft|wire fee|monthly maintenance|nsf|atm fee|foreign transaction)\b/i, '6050'],
  [/\b(interest charge|finance charge|interest paid)\b/i, '6051'],
  // Merchant processing (COGS)
  [/\b(stripe|square|paypal|clover|toast|shopify payments|braintree|authorize\.?net|merchant services)\b/i, '5010'],
  // Insurance
  [/\b(insurance|geico|state farm|progressive|allstate|hartford|hiscox|next insurance)\b/i, '6100'],
  // Legal / professional / accounting
  [/\b(law|legal|attorney|llp\b|esq\b)\b/i, '6110'],
  [/\b(accounting|bookkeep|cpa\b|tax prep|h&r block)\b/i, '6111'],
  // Utilities / telecom
  [/\b(comcast|xfinity|verizon|at&?t|t-?mobile|sprint|centurylink|spectrum|internet|electric|pg&e|con ?ed|water|sewer|utility|natural gas)\b/i, '6090'],
  [/\b(phone|cellular|mobile bill|ring ?central|dialpad|grasshopper)\b/i, '6091'],
  // Rent / equipment
  [/\b(rent|lease|wework|regus|office space)\b/i, '6060'],
  [/\b(dell|apple store|apple\.com|lenovo|hp store|newegg|micro center|b&h photo|hardware)\b/i, '6061'],
  // Dues / training / taxes
  [/\b(membership|dues|chamber of commerce|association)\b/i, '6120'],
  [/\b(udemy|coursera|pluralsight|training|seminar|conference|workshop|linkedin learning)\b/i, '6130'],
  [/\b(irs|franchise tax|state tax|business license|secretary of state|dmv|permit)\b/i, '6140'],
  [/\b(donation|charity|charitable|nonprofit|foundation)\b/i, '6150'],
];

const INCOME = /\b(deposit|payment from|real time payment from|zelle.*from|transfer from|incoming|ach credit|direct dep|invoice|remittance)\b/i;
const REFUND = /\b(refund|reimburse|return|reversal|credit adj)\b/i;
const INTEREST_IN = /\b(interest (earned|payment|credit)|dividend|apy)\b/i;

@Injectable()
export class BankAutoCategorizeService {
  private readonly logger = new Logger(BankAutoCategorizeService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Ensure the full category chart-of-accounts exists; returns num→id map. */
  async ensureAccounts(organizationId: string): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    const base = await this.prisma.account.findMany({ where: { organizationId } });
    for (const a of base) map[a.accountNumber] = a.id;
    for (const c of CATEGORIES) {
      if (!map[c.num]) {
        const a = await this.prisma.account.create({
          data: {
            organizationId,
            accountNumber: c.num,
            name: c.name,
            accountType: c.type,
            normalBalance: c.normal,
            isActive: true,
          },
        });
        map[c.num] = a.id;
      }
    }
    return map;
  }

  /** Rule-based first pass; returns how many were categorized and which remain. */
  async run(organizationId: string, useAi = false) {
    const acct = await this.ensureAccounts(organizationId);
    const incomeAcct = acct['4010'] || acct['4000'];

    const txns = await this.prisma.bankTransaction.findMany({
      where: { bankAccount: { organizationId }, categoryAccountId: null, excludeFromReconciliation: false },
      select: { id: true, description: true, amount: true },
    });

    let categorized = 0;
    const unresolved: { id: string; description: string; amount: number }[] = [];

    for (const t of txns) {
      const desc = t.description || '';
      const amt = Number(t.amount);
      let num: string | undefined;

      if (amt >= 0) {
        // inbound money → revenue
        if (INTEREST_IN.test(desc)) num = '4040';
        else if (REFUND.test(desc)) num = '4050';
        else if (INCOME.test(desc)) num = '4010';
      }
      if (!num) {
        for (const [re, n] of RULES) {
          if (re.test(desc)) {
            num = n;
            break;
          }
        }
      }
      // inbound with no rule match but clearly a deposit → generic income
      if (!num && amt >= 0) num = '4900';

      const accountId = num ? acct[num] : undefined;
      if (!accountId) {
        unresolved.push({ id: t.id, description: desc, amount: amt });
        continue;
      }
      const label = CATEGORIES.find((c) => c.num === num)?.name || 'Income';
      await this.prisma.bankTransaction.update({
        where: { id: t.id },
        data: { categoryAccountId: accountId, category: label, status: 'MATCHED' },
      });
      categorized++;
    }

    let aiCategorized = 0;
    const aiOn = useAi && (await isAiAvailable(AI));
    if (aiOn && unresolved.length) {
      aiCategorized = await this.aiPass(unresolved, acct);
    }

    return {
      total: txns.length,
      categorized,
      aiCategorized,
      remaining: unresolved.length - aiCategorized,
      aiUsed: aiOn,
    };
  }

  /** AI pass for the ambiguous ones — grounded in the org's category accounts. */
  private async aiPass(
    txns: { id: string; description: string; amount: number }[],
    acct: Record<string, string>,
  ): Promise<number> {
    const cats = CATEGORIES.map((c) => `${c.num} ${c.name}`).join(', ');
    const list = txns.slice(0, 80).map((t, i) => `${i}. "${t.description}" (${t.amount})`).join('\n');
    const system =
      'You categorize business bank transactions into GL accounts. Reply ONLY with a JSON array of ' +
      '{"i": <index>, "account": "<4-digit account number from the list>"}. Positive amounts are money in ' +
      '(revenue 4xxx), negative are money out (expense 5xxx/6xxx). Choose the best-fit account; omit any you truly cannot place.';
    const user = `Accounts: ${cats}, plus 6900 Miscellaneous Expense (fallback).\n\nTransactions:\n${list}`;

    let text = '';
    try {
      text = await chat({ system, prompt: user, maxTokens: 2000, config: await loadAiConfig(AI) });
    } catch (e) {
      this.logger.warn(`AI categorize failed: ${(e as Error).message}`);
      return 0;
    }

    let picks: { i: number; account: string }[] = [];
    try {
      picks = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    } catch {
      return 0;
    }
    let n = 0;
    for (const p of picks) {
      const t = txns[p.i];
      const accountId = acct[p.account] || acct['6900'];
      if (!t || !accountId) continue;
      const label = CATEGORIES.find((c) => c.num === p.account)?.name || 'Miscellaneous Expense';
      await this.prisma.bankTransaction.update({ where: { id: t.id }, data: { categoryAccountId: accountId, category: label, status: 'MATCHED' } });
      n++;
    }
    return n;
  }
}
