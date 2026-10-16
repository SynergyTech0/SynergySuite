/**
 * Synergy Books demo seed, idempotent.
 *
 * Creates an "Acme Corporation" demo company on a fresh database:
 *   - org_demo_1, owned by BOOKS_SEED_EMAIL (sign in to the suite as that user to see it)
 *   - a standard chart of accounts
 *   - customers + a vendor
 *   - 3 open invoices and 1 approved bill, each with a POSTED journal entry
 *     so the P&L / Balance Sheet / Trial Balance / A-R aging reports are
 *     populated immediately (reports read status=POSTED journal lines).
 *
 * Safe to re-run: master data is upserted; invoices/bills are created only
 * when their unique number does not already exist.
 *
 * Run:  npm run db:seed -w @synergy/books-api
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ORG_ID = 'org_demo_1';
const DEMO_EMAIL = (process.env.BOOKS_SEED_EMAIL || 'jane@acme.test').toLowerCase();

// Chart of accounts — [number, name, type, normalBalance, isBankAccount]
const ACCOUNTS: [string, string, 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE', 'DEBIT' | 'CREDIT', boolean][] = [
  ['1000', 'Cash', 'ASSET', 'DEBIT', true],
  ['1010', 'Undeposited Funds', 'ASSET', 'DEBIT', true],
  ['1100', 'Accounts Receivable', 'ASSET', 'DEBIT', false],
  ['1200', 'Inventory', 'ASSET', 'DEBIT', false],
  ['2000', 'Accounts Payable', 'LIABILITY', 'CREDIT', false],
  ['2300', 'Sales Tax Payable', 'LIABILITY', 'CREDIT', false],
  ['3000', "Owner's Equity", 'EQUITY', 'CREDIT', false],
  ['4000', 'Consulting Revenue', 'REVENUE', 'CREDIT', false],
  ['5000', 'Payroll Expense', 'EXPENSE', 'DEBIT', false],
  ['6000', 'Software & Subscriptions', 'EXPENSE', 'DEBIT', false],
];

async function main() {
  console.log('Seeding Synergy Books demo (org_demo_1 / Acme Corporation)…');

  // --- Organization ---------------------------------------------------------
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { name: 'Acme Corporation' },
    create: {
      id: ORG_ID,
      name: 'Acme Corporation',
      legalName: 'Acme Corporation LLC',
      entityType: 'LLC',
      accountingMethod: 'ACCRUAL',
      defaultCurrency: 'USD',
      fiscalYearEnd: 12,
      isActive: true,
    },
  });

  // --- Demo user ------------------------------------------------------------
  // Sign-in is the suite's; Books never checks this field.
  const passwordHash = '!';
  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { password: passwordHash, organizationId: ORG_ID },
    create: {
      email: DEMO_EMAIL,
      password: passwordHash,
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'ADMIN',
      organizationId: ORG_ID,
      isActive: true,
    },
  });

  // --- Chart of accounts ----------------------------------------------------
  const acct: Record<string, string> = {};
  for (const [number, name, accountType, normalBalance, isBankAccount] of ACCOUNTS) {
    const row = await prisma.account.upsert({
      where: { organizationId_accountNumber: { organizationId: ORG_ID, accountNumber: number } },
      update: { name, accountType, normalBalance, isBankAccount },
      create: { organizationId: ORG_ID, accountNumber: number, name, accountType, normalBalance, isBankAccount, isActive: true },
    });
    acct[number] = row.id;
  }

  // --- Customers ------------------------------------------------------------
  const customers: Record<string, string> = {};
  for (const [ext, name] of [
    ['cust-blue-ridge', 'Blue Ridge Clinic'],
    ['cust-cascade', 'Cascade Home Health'],
    ['cust-summit', 'Summit Physical Therapy'],
  ]) {
    const c = await prisma.customer.upsert({
      where: { organizationId_externalId: { organizationId: ORG_ID, externalId: ext } },
      update: { name },
      create: { organizationId: ORG_ID, externalId: ext, name, email: `ap@${ext}.test`, paymentTerms: 30, isActive: true },
    });
    customers[ext] = c.id;
  }

  // --- Vendor ---------------------------------------------------------------
  const aws = await prisma.vendor.upsert({
    where: { organizationId_externalId: { organizationId: ORG_ID, externalId: 'vend-aws' } },
    update: { name: 'AWS' },
    create: {
      organizationId: ORG_ID,
      externalId: 'vend-aws',
      name: 'AWS',
      email: 'billing@aws.test',
      paymentTerms: 30,
      defaultExpenseAccountId: acct['6000'],
      isActive: true,
    },
  });

  // --- Vendor bank account (ACH recipient; account number is base64 "encrypted") ---
  const existingVba = await prisma.vendorBankAccount.findFirst({ where: { vendorId: aws.id } });
  if (!existingVba) {
    await prisma.vendorBankAccount.create({
      data: {
        vendorId: aws.id,
        accountType: 'CHECKING',
        bankName: 'Bank of America',
        routingNumber: '026009593',
        accountNumber: Buffer.from('123456789').toString('base64'),
        accountLast4: '****6789',
        nameOnAccount: 'Amazon Web Services Inc',
        isActive: true,
        isPrimary: true,
        status: 'ACTIVE',
      },
    });
  }

  // --- Bank account (linked to Cash GL) -------------------------------------
  const existingBank = await prisma.bankAccount.findFirst({ where: { organizationId: ORG_ID, accountNumber: '4321' } });
  if (!existingBank) {
    await prisma.bankAccount.create({
      data: {
        organizationId: ORG_ID,
        accountId: acct['1000'],
        bankName: 'First National',
        accountName: 'Operating Checking',
        accountNumber: '4321',
        routingNumber: '021000021',
        accountType: 'CHECKING',
        currency: 'USD',
        currentBalance: 0,
        availableBalance: 0,
        isActive: true,
        isPrimary: true,
      },
    });
  }

  // --- Inventory items (referenced by bundles/kits) -------------------------
  const items: [string, string, number, number][] = [
    // sku, name, unitCost, sellingPrice
    ['SKU-KBD', 'Mechanical Keyboard', 45, 89],
    ['SKU-MOU', 'Wireless Mouse', 12, 29],
    ['SKU-HUB', 'USB-C Hub', 18, 49],
  ];
  for (const [sku, name, unitCost, sellingPrice] of items) {
    await prisma.inventoryItem.upsert({
      where: { organizationId_sku: { organizationId: ORG_ID, sku } },
      update: { name, unitCost, sellingPrice },
      create: {
        organizationId: ORG_ID,
        sku,
        name,
        unitCost,
        sellingPrice,
        quantity: 100,
        reorderPoint: 10,
        accountId: acct['1200'],
      },
    });
  }

  // --- Invoices (+ posted journals: DR A/R, CR Revenue) ---------------------
  const invoices: [string, string, number][] = [
    ['INV-2026-00001', 'cust-blue-ridge', 5000],
    ['INV-2026-00002', 'cust-blue-ridge', 3200],
    ['INV-2026-00003', 'cust-cascade', 8500],
  ];
  let jseq = 1;
  for (const [number, custExt, total] of invoices) {
    const exists = await prisma.invoice.findUnique({
      where: { organizationId_invoiceNumber: { organizationId: ORG_ID, invoiceNumber: number } },
    });
    if (exists) continue;

    const journal = await prisma.journal.create({
      data: {
        organizationId: ORG_ID,
        journalNumber: `GJ-2026-${String(jseq++).padStart(6, '0')}`,
        journalDate: new Date('2026-07-10'),
        sourceType: 'INVOICE',
        status: 'POSTED',
        postedAt: new Date('2026-07-10'),
        reference: number,
        description: `Invoice #${number}`,
        lines: {
          create: [
            { lineNumber: 1, accountId: acct['1100'], debit: total, credit: 0, description: `Invoice #${number}`, referenceType: 'INVOICE' },
            { lineNumber: 2, accountId: acct['4000'], debit: 0, credit: total, description: `Invoice #${number} - Revenue` },
          ],
        },
      },
    });

    await prisma.invoice.create({
      data: {
        organizationId: ORG_ID,
        customerId: customers[custExt],
        invoiceNumber: number,
        invoiceDate: new Date('2026-07-10'),
        dueDate: new Date('2026-08-09'),
        status: 'SENT',
        sentAt: new Date('2026-07-10'),
        subtotal: total,
        taxAmount: 0,
        totalAmount: total,
        amountPaid: 0,
        amountDue: total,
        journalId: journal.id,
        lineItems: {
          create: [{ lineNumber: 1, description: 'Consulting services', quantity: 1, unitPrice: total, amount: total, accountId: acct['4000'] }],
        },
      },
    });
  }

  // --- Bill (+ posted journal: DR Expense, CR A/P) --------------------------
  const billNumber = 'BILL-2026-0001';
  const billExists = await prisma.bill.findFirst({ where: { organizationId: ORG_ID, billNumber } });
  if (!billExists) {
    const billTotal = 1200;
    const journal = await prisma.journal.create({
      data: {
        organizationId: ORG_ID,
        journalNumber: `GJ-2026-${String(jseq++).padStart(6, '0')}`,
        journalDate: new Date('2026-07-12'),
        sourceType: 'BILL',
        status: 'POSTED',
        postedAt: new Date('2026-07-12'),
        reference: billNumber,
        description: `Bill #${billNumber} - AWS`,
        lines: {
          create: [
            { lineNumber: 1, accountId: acct['6000'], debit: billTotal, credit: 0, description: 'Cloud hosting', referenceType: 'BILL' },
            { lineNumber: 2, accountId: acct['2000'], debit: 0, credit: billTotal, description: `Bill #${billNumber}` },
          ],
        },
      },
    });

    await prisma.bill.create({
      data: {
        organizationId: ORG_ID,
        vendorId: aws.id,
        billNumber,
        billDate: new Date('2026-07-12'),
        dueDate: new Date('2026-08-11'),
        status: 'APPROVED',
        approvedAt: new Date('2026-07-12'),
        subtotal: billTotal,
        taxAmount: 0,
        totalAmount: billTotal,
        amountPaid: 0,
        amountDue: billTotal,
        balance: billTotal,
        journalId: journal.id,
        lineItems: {
          create: [{ lineNumber: 1, description: 'Cloud hosting', quantity: 1, unitPrice: billTotal, amount: billTotal, accountId: acct['6000'] }],
        },
      },
    });
  }

  console.log('✓ Demo seed complete.');
  console.log(`  Owner: ${DEMO_EMAIL}  (org ${ORG_ID})`);
  console.log('  A/R 16,700 · Revenue 16,700 · A/P 1,200 · Expense 1,200');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
