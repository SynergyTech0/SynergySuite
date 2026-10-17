/*
 * Brings the books over from an older Synergy Hub's SynergyBooks. Reads the hub's export
 * (deploy/hub-import/books.sql) as JSON on stdin; deploy/hub-import/run.sh does both steps.
 *
 *   - Company: the hub's organization becomes a new company here, with its own chart of
 *     accounts, so nothing already in Books is touched. --into-org <id> puts it into a
 *     company you already have instead: accounts are matched by number, customers by email
 *     or name, and journal or invoice numbers that are taken get a HUB- prefix.
 *   - People: matched to Books users by email. Anyone not in Books yet gets a Books user in
 *     the imported company; sign-in stays with the suite (Books never kept their passwords).
 *     Everyone joins the imported company with their hub role. Someone whose current company
 *     has no journals yet starts working in the imported one; --keep-company leaves them.
 *   - Ledger: journals and lines (with their AI tax classifications and citations), customers,
 *     invoices, bank accounts (last four digits and the Stripe bank-connection handles, which
 *     are not secrets) and bank transactions. The trial balance of the imported journals is
 *     checked against the hub's before anything is saved.
 *   - Tax library: the IRC sections the Tax AI reads. The suite doesn't ship them, so they
 *     come across unless they're already here (--skip-tax-library leaves them).
 *
 * Rows keep their hub ids, which is how a second run knows what it already brought over:
 * running again adds only what is missing. --dry-run does the whole import in a transaction
 * and rolls it back, so the counts it prints are exact.
 */
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';

const { PrismaClient, Prisma } = prismaPkg;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${name} needs a value.`);
  return v;
};
const DRY = flag('--dry-run');
const INTO_ORG = option('--into-org');
const COMPANY_NAME = option('--company-name');
const KEEP_COMPANY = flag('--keep-company');
const SKIP_TAX = flag('--skip-tax-library');

const COMPANY_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'USER'];
const D = Prisma.Decimal;
class Rollback extends Error {}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('No hub export on stdin. Run deploy/hub-import/run.sh.');
  return JSON.parse(text);
}

/** Postgres `timestamp` columns come out without a zone; Prisma stores them as UTC. */
const date = (v) => (v == null ? null : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`));
/** Optional Json columns take undefined, not null. */
const json = (v) => (v == null ? undefined : v);
const role = (r) => (COMPANY_ROLES.includes(String(r).toUpperCase()) ? String(r).toUpperCase() : 'USER');
const log = (s) => console.log((DRY ? '[dry run] ' : '') + s);

async function main() {
  const hub = await readStdin();
  const orgs = hub.organizations ?? [];
  if (!orgs.length) throw new Error('The hub export has no organization.');
  if (INTO_ORG && orgs.length > 1) throw new Error('The hub has several companies; --into-org takes one at a time.');

  const prisma = new PrismaClient();
  const totals = [];
  try {
    for (const org of orgs) {
      try {
        await prisma.$transaction((tx) => importCompany(tx, hub, org, totals), { timeout: 600_000, maxWait: 30_000 });
      } catch (e) {
        if (!(e instanceof Rollback)) throw e;
      }
    }
    const tax = SKIP_TAX ? 'left out (--skip-tax-library)' : await importTaxLibrary(prisma, hub);

    console.log('');
    for (const t of totals) console.log(t);
    console.log(`Tax library: ${tax}.`);
    const behind = Object.entries(hub.left_behind ?? {});
    if (behind.length) console.log(`Not brought over (no importer for these yet): ${behind.map(([k, n]) => `${k} ${n}`).join(', ')}.`);
    if (DRY) console.log('Dry run: nothing was written.');
  } finally {
    await prisma.$disconnect();
  }
}

/** Ids from `ids` that already exist in `model`. */
async function existing(model, ids) {
  if (!ids.length) return new Set();
  const rows = await model.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Works out which company the hub's organization goes to, creating it if needed. */
async function targetCompany(tx, hub, org) {
  if (INTO_ORG) {
    const found = await tx.organization.findUnique({ where: { id: INTO_ORG } });
    if (!found) throw new Error(`No Books company with id ${INTO_ORG}.`);
    return { id: found.id, name: found.name, created: false };
  }
  const same = await tx.organization.findUnique({ where: { id: org.id } });
  if (same) return { id: same.id, name: same.name, created: false };

  // An earlier run with --into-org: its journals or bank accounts are already somewhere.
  const ids = (k) => (hub[k] ?? []).filter((r) => r.organizationId === org.id).map((r) => r.id);
  const earlier =
    (await tx.journal.findFirst({ where: { id: { in: ids('journals') } }, select: { organizationId: true } })) ??
    (await tx.bankAccount.findFirst({ where: { id: { in: ids('bank_accounts') } }, select: { organizationId: true } })) ??
    (await tx.customer.findFirst({ where: { id: { in: ids('customers') } }, select: { organizationId: true } }));
  if (earlier) {
    const o = await tx.organization.findUnique({ where: { id: earlier.organizationId } });
    log(`${org.name} was imported into ${o.name} (${o.id}) before; adding what is missing there`);
    return { id: o.id, name: o.name, created: false };
  }

  const created = await tx.organization.create({
    data: {
      id: org.id,
      name: COMPANY_NAME || org.name,
      legalName: org.legalName,
      entityType: org.entityType,
      taxId: org.taxId,
      fiscalYearEnd: org.fiscalYearEnd ?? 12,
      accountingMethod: org.accountingMethod,
      industry: org.industry,
      stateOfIncorporation: org.stateOfIncorporation,
      naicsCode: org.naicsCode,
      address: json(org.address),
      settings: json(org.settings) ?? {},
      defaultCurrency: org.defaultCurrency || 'USD',
      isActive: org.isActive !== false,
    },
  });
  return { id: created.id, name: created.name, created: true };
}

async function importCompany(tx, hub, org, totals) {
  const mine = (k) => (hub[k] ?? []).filter((r) => r.organizationId === org.id);
  const target = await targetCompany(tx, hub, org);
  const orgId = target.id;
  log(target.created ? `${org.name}: new company ${target.name} (${orgId})` : `${org.name}: into ${target.name} (${orgId})`);

  // Chart of accounts, matched by account number.
  const accountMap = new Map();
  const byNumber = new Map(
    (await tx.account.findMany({ where: { organizationId: orgId }, select: { id: true, accountNumber: true } })).map((a) => [a.accountNumber, a.id]),
  );
  const hubAccounts = mine('accounts');
  const takenAccountIds = await existing(tx.account, hubAccounts.map((a) => a.id));
  const newAccounts = [];
  let accountsMatched = 0;
  for (const a of hubAccounts) {
    const found = byNumber.get(a.accountNumber);
    if (found) { accountMap.set(a.id, found); accountsMatched++; continue; }
    const id = takenAccountIds.has(a.id) ? randomUUID() : a.id;
    accountMap.set(a.id, id);
    newAccounts.push({ ...a, newId: id });
  }
  if (newAccounts.length) {
    await tx.account.createMany({
      data: newAccounts.map((a) => ({
        id: a.newId,
        organizationId: orgId,
        accountNumber: a.accountNumber,
        name: a.name,
        description: a.description,
        accountType: a.accountType,
        accountSubtype: a.accountSubtype,
        normalBalance: a.normalBalance,
        taxCode: a.taxCode,
        currency: a.currency ?? 'USD',
        isActive: a.isActive,
        isBankAccount: a.isBankAccount,
        isSystemAccount: a.isSystemAccount,
        createdAt: date(a.createdAt),
      })),
    });
    for (const a of newAccounts) {
      const parentId = a.parentId ? accountMap.get(a.parentId) : null;
      if (parentId) await tx.account.update({ where: { id: a.newId }, data: { parentId } });
    }
  }

  // People, by email.
  const userMap = new Map();
  let usersAdded = 0, usersJoined = 0, usersMoved = 0;
  for (const u of hub.users ?? []) {
    if (u.organizationId !== org.id) continue;
    const email = String(u.email).trim().toLowerCase();
    const r = role(u.role);
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      const idTaken = await tx.user.findUnique({ where: { id: u.id }, select: { id: true } });
      user = await tx.user.create({
        data: {
          id: idTaken ? randomUUID() : u.id,
          email,
          // Sign-in is the suite's; Books never stores or checks a password.
          password: '!',
          firstName: u.firstName || email.split('@')[0],
          lastName: u.lastName || '',
          organizationId: orgId,
          role: r,
          isActive: u.isActive !== false,
        },
      });
      usersAdded++;
      log(`added ${email} (${r})`);
    } else if (user.organizationId !== orgId && !KEEP_COMPANY) {
      // Keep their current company as a membership, then move them if it has no books yet.
      await tx.organizationUser.upsert({
        where: { organizationId_userId: { organizationId: user.organizationId, userId: user.id } },
        create: { organizationId: user.organizationId, userId: user.id, role: user.role, permissions: [] },
        update: {},
      });
      const used = await tx.journal.count({ where: { organizationId: user.organizationId } });
      if (!used) {
        user = await tx.user.update({ where: { id: user.id }, data: { organizationId: orgId, role: r } });
        usersMoved++;
        log(`${email} now works in ${target.name} (their other company had no journals)`);
      }
    }
    userMap.set(u.id, user.id);
    const member = await tx.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    });
    if (!member) {
      await tx.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role: r, permissions: [] } });
      usersJoined++;
    }
  }
  const person = (id) => (id ? userMap.get(id) ?? null : null);

  // Fiscal periods, by year, type and number.
  const periodMap = new Map();
  for (const p of mine('fiscal_periods')) {
    const key = { organizationId: orgId, fiscalYear: p.fiscalYear, periodType: p.periodType, periodNumber: p.periodNumber };
    const found = p.fiscalYear == null ? null : await tx.fiscalPeriod.findFirst({ where: key });
    if (found) { periodMap.set(p.id, found.id); continue; }
    const made = await tx.fiscalPeriod.create({
      data: {
        ...key,
        id: (await tx.fiscalPeriod.findUnique({ where: { id: p.id } })) ? randomUUID() : p.id,
        name: p.name,
        startDate: date(p.startDate),
        endDate: date(p.endDate),
        status: p.status,
        closedAt: date(p.closedAt),
        closedBy: person(p.closedBy),
        createdAt: date(p.createdAt),
      },
    });
    periodMap.set(p.id, made.id);
  }

  // Customers, by hub id, else by email or name in the company.
  const customerMap = new Map();
  let customersAdded = 0;
  for (const c of mine('customers')) {
    const found =
      (await tx.customer.findUnique({ where: { id: c.id }, select: { id: true } })) ??
      (c.email ? await tx.customer.findFirst({ where: { organizationId: orgId, email: { equals: c.email, mode: 'insensitive' } } }) : null) ??
      (await tx.customer.findFirst({ where: { organizationId: orgId, name: c.name } }));
    if (found) { customerMap.set(c.id, found.id); continue; }
    await tx.customer.create({
      data: {
        id: c.id,
        organizationId: orgId,
        name: c.name,
        email: c.email,
        phone: c.phone,
        billingAddress: json(c.billingAddress),
        shippingAddress: json(c.shippingAddress),
        taxExempt: c.taxExempt,
        taxExemptNumber: c.taxExemptNumber,
        creditLimit: c.creditLimit,
        paymentTerms: c.paymentTerms,
        company: c.company,
        taxId: c.taxId,
        balance: c.balance,
        isActive: c.isActive,
        notes: c.notes,
        createdAt: date(c.createdAt),
      },
    });
    customerMap.set(c.id, c.id);
    customersAdded++;
  }

  // Journals with their lines.
  const hubJournals = mine('journals');
  const journalIds = new Set(hubJournals.map((j) => j.id));
  const linesByJournal = new Map();
  for (const l of hub.journal_lines ?? []) {
    if (!journalIds.has(l.journalId)) continue;
    if (!linesByJournal.has(l.journalId)) linesByJournal.set(l.journalId, []);
    linesByJournal.get(l.journalId).push(l);
  }
  const haveJournals = await existing(tx.journal, [...journalIds]);
  const numbers = new Set(
    (await tx.journal.findMany({ where: { organizationId: orgId }, select: { journalNumber: true } })).map((j) => j.journalNumber),
  );
  let journalsAdded = 0, renumbered = 0;
  for (const j of hubJournals) {
    if (haveJournals.has(j.id)) continue;
    let journalNumber = j.journalNumber;
    if (numbers.has(journalNumber)) { journalNumber = `HUB-${journalNumber}`; renumbered++; }
    numbers.add(journalNumber);
    const lines = linesByJournal.get(j.id) ?? [];
    for (const l of lines) {
      if (!accountMap.has(l.accountId)) throw new Error(`Journal ${j.journalNumber} uses an account the hub export doesn't have.`);
    }
    await tx.journal.create({
      data: {
        id: j.id,
        organizationId: orgId,
        periodId: j.periodId ? periodMap.get(j.periodId) ?? null : null,
        journalNumber,
        journalDate: date(j.journalDate),
        description: j.description,
        reference: j.reference,
        sourceType: j.sourceType,
        sourceId: j.sourceId,
        status: j.status,
        type: j.type,
        tags: j.tags ?? [],
        createdBy: person(j.createdBy),
        voidedAt: date(j.voidedAt),
        voidReason: j.voidReason,
        voidedBy: person(j.voidedBy),
        isAdjusting: j.isAdjusting,
        isReversing: j.isReversing,
        postedAt: date(j.postedAt),
        postedBy: person(j.postedBy),
        createdAt: date(j.createdAt),
        lines: {
          create: lines.map((l) => ({
            id: l.id,
            lineNumber: l.lineNumber,
            accountId: accountMap.get(l.accountId),
            description: l.description,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo,
            referenceType: l.referenceType,
            referenceId: l.referenceId,
            taxCode: l.taxCode,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            createdAt: date(l.createdAt),
          })),
        },
      },
    });
    journalsAdded++;
  }
  // Reversal links, now that both ends exist.
  for (const j of hubJournals) {
    if (haveJournals.has(j.id)) continue;
    const reverses = j.reversesJournalId && journalIds.has(j.reversesJournalId) ? j.reversesJournalId : null;
    const reversedBy = j.reversedByJournalId && journalIds.has(j.reversedByJournalId) ? j.reversedByJournalId : null;
    if (reverses || reversedBy) {
      await tx.journal.update({ where: { id: j.id }, data: { reversesJournalId: reverses, reversedByJournalId: reversedBy } });
    }
  }

  // AI tax classifications of those lines, and their citations.
  const lineIds = new Set([...linesByJournal.values()].flat().map((l) => l.id));
  const hubTax = (hub.line_tax ?? []).filter((c) => lineIds.has(c.journalLineId));
  const haveTax = new Set(
    (await tx.journalLineTaxClassification.findMany({
      where: { OR: [{ id: { in: hubTax.map((c) => c.id) } }, { journalLineId: { in: hubTax.map((c) => c.journalLineId) } }] },
      select: { id: true, journalLineId: true },
    })).flatMap((c) => [c.id, c.journalLineId]),
  );
  const newTax = hubTax.filter((c) => !haveTax.has(c.id) && !haveTax.has(c.journalLineId));
  if (newTax.length) {
    await tx.journalLineTaxClassification.createMany({
      data: newTax.map((c) => ({
        id: c.id,
        journalLineId: c.journalLineId,
        taxTreatment: c.taxTreatment,
        ircSection: c.ircSection,
        regulationRef: c.regulationRef,
        deductionType: c.deductionType,
        deductionLimit: c.deductionLimit,
        limitedAmount: c.limitedAmount,
        disallowedAmount: c.disallowedAmount,
        carryforwardAmount: c.carryforwardAmount,
        recognitionYear: c.recognitionYear,
        isDeferral: c.isDeferral,
        deferralEndYear: c.deferralEndYear,
        requiredDocs: c.requiredDocs ?? [],
        hasRequiredDocs: c.hasRequiredDocs,
        confidence: c.confidence,
        auditRiskLevel: c.auditRiskLevel,
        auditRiskFactors: c.auditRiskFactors ?? [],
        category: c.category,
        classifiedAt: date(c.classifiedAt),
        deductibility: c.deductibility,
        deductiblePercentage: c.deductiblePercentage,
        explanation: c.explanation,
        formPlacement: json(c.formPlacement),
        isManualOverride: c.isManualOverride,
        createdAt: date(c.createdAt),
      })),
    });
  }
  const taxIds = new Set(newTax.map((c) => c.id));
  const newCitations = (hub.citations ?? []).filter(
    (c) => taxIds.has(c.journalLineTaxClassificationId) || taxIds.has(c.classificationId),
  );
  if (newCitations.length) {
    const haveCitations = await existing(tx.taxCitation, newCitations.map((c) => c.id));
    await tx.taxCitation.createMany({
      data: newCitations.filter((c) => !haveCitations.has(c.id)).map((c) => ({
        id: c.id,
        classificationId: taxIds.has(c.classificationId) ? c.classificationId : null,
        journalLineTaxClassificationId: c.journalLineTaxClassificationId,
        authorityType: c.authorityType,
        authorityId: c.authorityId,
        section: c.section,
        regulation: c.regulation,
        publication: c.publication,
        courtCase: c.courtCase,
        citationText: c.citationText,
        relevanceScore: c.relevanceScore,
        createdAt: date(c.createdAt),
      })),
    });
  }

  // Invoices with their lines.
  const hubInvoices = mine('invoices');
  const haveInvoices = await existing(tx.invoice, hubInvoices.map((i) => i.id));
  const invoiceNumbers = new Set(
    (await tx.invoice.findMany({ where: { organizationId: orgId }, select: { invoiceNumber: true } })).map((i) => i.invoiceNumber),
  );
  const invoiceLines = hub.invoice_lines ?? [];
  let invoicesAdded = 0, invoicesRenumbered = 0;
  for (const i of hubInvoices) {
    if (haveInvoices.has(i.id)) continue;
    let invoiceNumber = i.invoiceNumber;
    if (invoiceNumbers.has(invoiceNumber)) { invoiceNumber = `HUB-${invoiceNumber}`; invoicesRenumbered++; }
    invoiceNumbers.add(invoiceNumber);
    await tx.invoice.create({
      data: {
        id: i.id,
        organizationId: orgId,
        customerId: customerMap.get(i.customerId),
        invoiceNumber,
        invoiceDate: date(i.invoiceDate),
        dueDate: date(i.dueDate),
        status: i.status,
        subtotal: i.subtotal,
        taxAmount: i.taxAmount,
        totalAmount: i.totalAmount,
        amountPaid: i.amountPaid,
        amountDue: i.amountDue,
        discountAmount: i.discountAmount,
        poNumber: i.poNumber,
        memo: i.memo,
        sentAt: date(i.sentAt),
        paidAt: date(i.paidAt),
        voidedAt: date(i.voidedAt),
        voidReason: i.voidReason,
        terms: i.terms,
        notes: i.notes,
        journalId: i.journalId && journalIds.has(i.journalId) ? i.journalId : null,
        stripeInvoiceId: i.stripeInvoiceId,
        stripeHostedUrl: i.stripeHostedUrl,
        createdAt: date(i.createdAt),
        lineItems: {
          create: invoiceLines.filter((l) => l.invoiceId === i.id).map((l) => ({
            id: l.id,
            lineNumber: l.lineNumber,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            accountId: l.accountId ? accountMap.get(l.accountId) ?? null : null,
            productId: l.productId,
            discountPercent: l.discountPercent,
            taxRate: l.taxRate,
            taxAmount: l.taxAmount,
            taxable: l.taxable,
            createdAt: date(l.createdAt),
          })),
        },
      },
    });
    invoicesAdded++;
  }

  // Bank accounts: the hub keeps only the last four digits, like Books, plus the handles of
  // the Stripe Financial Connections account they were linked through.
  const bankMap = new Map();
  let banksAdded = 0;
  for (const b of mine('bank_accounts')) {
    const found =
      (await tx.bankAccount.findUnique({ where: { id: b.id }, select: { id: true } })) ??
      (b.plaidAccessToken
        ? await tx.bankAccount.findFirst({ where: { organizationId: orgId, plaidAccessToken: b.plaidAccessToken }, select: { id: true } })
        : null);
    if (found) { bankMap.set(b.id, found.id); continue; }
    await tx.bankAccount.create({
      data: {
        id: b.id,
        organizationId: orgId,
        accountId: accountMap.get(b.accountId),
        bankName: b.bankName,
        accountName: b.accountName,
        accountNumber: String(b.accountNumber ?? '').slice(-4),
        routingNumber: b.routingNumber,
        accountType: b.accountType,
        currency: b.currency,
        currentBalance: b.currentBalance,
        availableBalance: b.availableBalance,
        plaidItemId: b.plaidItemId,
        plaidAccessToken: b.plaidAccessToken,
        lastSyncAt: date(b.lastSyncAt),
        isActive: b.isActive,
        isPrimary: b.isPrimary,
        createdAt: date(b.createdAt),
      },
    });
    bankMap.set(b.id, b.id);
    banksAdded++;
  }

  // Bank transactions: skip ones already here by hub id, or that a bank sync already pulled.
  const hubTx = (hub.bank_transactions ?? []).filter((t) => bankMap.has(t.bankAccountId));
  const haveTx = await existing(tx.bankTransaction, hubTx.map((t) => t.id));
  const synced = new Set(
    (await tx.bankTransaction.findMany({
      where: { bankAccountId: { in: [...new Set(bankMap.values())] }, externalId: { not: null } },
      select: { bankAccountId: true, externalId: true },
    })).map((t) => `${t.bankAccountId}|${t.externalId}`),
  );
  const newTx = hubTx.filter((t) => !haveTx.has(t.id) && !(t.externalId && synced.has(`${bankMap.get(t.bankAccountId)}|${t.externalId}`)));
  if (newTx.length) {
    await tx.bankTransaction.createMany({
      data: newTx.map((t) => ({
        id: t.id,
        bankAccountId: bankMap.get(t.bankAccountId),
        externalId: t.externalId,
        transactionDate: date(t.transactionDate),
        postDate: date(t.postDate),
        description: t.description,
        originalDescription: t.originalDescription,
        amount: t.amount,
        transactionType: t.transactionType,
        category: t.category,
        merchantName: t.merchantName,
        pending: t.pending,
        status: t.status,
        reference: t.reference,
        referenceNumber: t.referenceNumber,
        categoryAccountId: t.categoryAccountId ? accountMap.get(t.categoryAccountId) ?? null : null,
        customerId: t.customerId ? customerMap.get(t.customerId) ?? null : null,
        matchedJournalId: t.matchedJournalId && journalIds.has(t.matchedJournalId) ? t.matchedJournalId : null,
        matchConfidence: t.matchConfidence,
        matchMethod: t.matchMethod,
        excludeFromReconciliation: t.excludeFromReconciliation,
        metadata: json(t.metadata),
        createdAt: date(t.createdAt),
      })),
    });
  }

  // The imported journals must give the hub's trial balance, account by account.
  const numberOf = new Map(hubAccounts.map((a) => [a.id, a.accountNumber]));
  const want = new Map();
  for (const l of [...linesByJournal.values()].flat()) {
    const n = numberOf.get(l.accountId);
    const t = want.get(n) ?? { dr: new D(0), cr: new D(0) };
    want.set(n, { dr: t.dr.plus(l.debit), cr: t.cr.plus(l.credit) });
  }
  const got = new Map();
  const lines = await tx.journalLine.findMany({
    where: { journalId: { in: [...journalIds] } },
    select: { debit: true, credit: true, account: { select: { accountNumber: true } } },
  });
  for (const l of lines) {
    const n = l.account.accountNumber;
    const t = got.get(n) ?? { dr: new D(0), cr: new D(0) };
    got.set(n, { dr: t.dr.plus(l.debit), cr: t.cr.plus(l.credit) });
  }
  const off = [...new Set([...want.keys(), ...got.keys()])].filter((n) => {
    const a = want.get(n), b = got.get(n);
    return !a || !b || !a.dr.equals(b.dr) || !a.cr.equals(b.cr);
  });
  if (off.length) throw new Error(`Trial balance differs from the hub for account(s) ${off.join(', ')}; nothing was saved.`);
  let dr = new D(0), cr = new D(0);
  for (const t of want.values()) { dr = dr.plus(t.dr); cr = cr.plus(t.cr); }

  totals.push(
    `${target.name} (${orgId})${target.created ? ', new company' : ''}:`,
    `  People: ${usersAdded} added to Books, ${usersJoined} given access, ${usersMoved} moved to work in it.`,
    `  Accounts: ${newAccounts.length} added, ${accountsMatched} matched by number.`,
    `  Journals: ${journalsAdded} added (${hubJournals.length - journalsAdded} already here)${renumbered ? `, ${renumbered} numbers prefixed HUB-` : ''}; tax classifications ${newTax.length} added.`,
    `  Customers: ${customersAdded} added. Invoices: ${invoicesAdded} added${invoicesRenumbered ? `, ${invoicesRenumbered} numbers prefixed HUB-` : ''}.`,
    `  Bank accounts: ${banksAdded} added. Bank transactions: ${newTx.length} added (${hubTx.length - newTx.length} already here).`,
    `  Trial balance of the hub's journals: debits ${dr.toFixed(2)}, credits ${cr.toFixed(2)}, matches the hub across ${want.size} accounts.`,
  );
  if (DRY) throw new Rollback();
}

/** The IRC sections the Tax AI searches. Shared by every company. */
async function importTaxLibrary(prisma, hub) {
  const sections = hub.tax_sections ?? [];
  if (!sections.length) return 'none in the hub';
  let docs = 0, added = 0, present = 0;
  for (const d of hub.tax_documents ?? []) {
    const mineSections = sections.filter((s) => s.documentId === d.id);
    const here = await prisma.taxSection.count({ where: { documentId: d.id } });
    if (here >= mineSections.length) { present += here; continue; }
    const haveIds = new Set((await prisma.taxSection.findMany({ where: { documentId: d.id }, select: { id: true } })).map((s) => s.id));
    const todo = mineSections.filter((s) => !haveIds.has(s.id));
    added += todo.length;
    docs++;
    if (DRY) continue;
    const src = (hub.tax_sources ?? []).find((s) => s.id === d.sourceId);
    if (src) {
      await prisma.taxCorpusSource.createMany({
        skipDuplicates: true,
        data: [{
          id: src.id, sourceType: src.sourceType, sourceUrl: src.sourceUrl, sourceName: src.sourceName,
          lastCrawled: date(src.lastCrawled), lastModified: date(src.lastModified), contentHash: src.contentHash,
          status: src.status, metadata: json(src.metadata), createdAt: date(src.createdAt),
        }],
      });
    }
    await prisma.taxDocument.createMany({
      skipDuplicates: true,
      data: [{
        id: d.id, sourceId: d.sourceId, documentType: d.documentType, identifier: d.identifier, title: d.title,
        rawContent: d.rawContent, parsedContent: json(d.parsedContent), effectiveDate: date(d.effectiveDate),
        expirationDate: date(d.expirationDate), version: d.version, contentHash: d.contentHash, status: d.status,
        metadata: json(d.metadata), createdAt: date(d.createdAt),
      }],
    });
    // Parents before children.
    todo.sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
    for (let i = 0; i < todo.length; i += 200) {
      await prisma.taxSection.createMany({
        skipDuplicates: true,
        data: todo.slice(i, i + 200).map((s) => ({
          id: s.id, documentId: s.documentId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle,
          fullPath: s.fullPath, parentId: s.parentId, content: s.content, summary: s.summary,
          effectiveDate: date(s.effectiveDate), expirationDate: date(s.expirationDate), createdAt: date(s.createdAt),
        })),
      });
    }
  }
  return added ? `${added} sections added from ${docs} document(s)${present ? `, ${present} already here` : ''}` : `already here (${present} sections)`;
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
