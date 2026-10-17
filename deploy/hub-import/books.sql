-- hub-import: container=synergybooks-db service=books
-- What run.sh reads from an older Synergy Hub's SynergyBooks database: the company, its
-- people (email, name and role only; Books never used their passwords), chart of accounts,
-- journals with their tax classifications, customers and invoices, bank accounts (last four
-- digits and the bank-connection handles) with their transactions, and the IRC tax library
-- the Tax AI reads. Amounts go out as text so no cents are lost on the way. `left_behind`
-- counts rows in every other table, so the importer can say what didn't come across.
SELECT json_build_object(
  'organizations', (SELECT coalesce(json_agg(o ORDER BY o."createdAt"), '[]') FROM (
    SELECT id, name, "legalName", "entityType", "taxId", "fiscalYearEnd", "accountingMethod", industry,
           "stateOfIncorporation", "naicsCode", address, settings, "defaultCurrency", "isActive", "createdAt"
    FROM "Organization") o),
  'users', (SELECT coalesce(json_agg(u ORDER BY u."createdAt"), '[]') FROM (
    SELECT id, "organizationId", email, "firstName", "lastName", role, "isActive", "createdAt" FROM "User") u),
  'accounts', (SELECT coalesce(json_agg(a ORDER BY a."accountNumber"), '[]') FROM (
    SELECT id, "organizationId", "accountNumber", name, description, "accountType", "accountSubtype", "normalBalance",
           "taxCode", currency, "isActive", "isBankAccount", "isSystemAccount", "parentId", "createdAt"
    FROM "Account") a),
  'fiscal_periods', (SELECT coalesce(json_agg(p), '[]') FROM (
    SELECT id, "organizationId", "periodType", "periodNumber", "fiscalYear", name, "startDate", "endDate", status,
           "closedAt", "closedBy", "createdAt"
    FROM "FiscalPeriod") p),
  'journals', (SELECT coalesce(json_agg(j ORDER BY j."journalDate", j."journalNumber"), '[]') FROM (
    SELECT id, "organizationId", "periodId", "journalNumber", "journalDate", description, reference, "sourceType", "sourceId",
           status, type, tags, "createdBy", "voidedAt", "voidReason", "voidedBy", "isAdjusting", "isReversing",
           "reversesJournalId", "reversedByJournalId", "postedAt", "postedBy", "createdAt"
    FROM "Journal") j),
  'journal_lines', (SELECT coalesce(json_agg(l ORDER BY l."journalId", l."lineNumber"), '[]') FROM (
    SELECT id, "journalId", "lineNumber", "accountId", description, debit::text, credit::text, memo, "referenceType",
           "referenceId", "taxCode", quantity::text, "unitPrice"::text, "createdAt"
    FROM "JournalLine") l),
  'line_tax', (SELECT coalesce(json_agg(c), '[]') FROM (
    SELECT id, "journalLineId", "taxTreatment", "ircSection", "regulationRef", "deductionType", "deductionLimit",
           "limitedAmount"::text, "disallowedAmount"::text, "carryforwardAmount"::text, "recognitionYear", "isDeferral",
           "deferralEndYear", "requiredDocs", "hasRequiredDocs", confidence, "auditRiskLevel", "auditRiskFactors", category,
           "classifiedAt", deductibility, "deductiblePercentage", explanation, "formPlacement", "isManualOverride", "createdAt"
    FROM "JournalLineTaxClassification") c),
  'citations', (SELECT coalesce(json_agg(c), '[]') FROM (
    SELECT id, "classificationId", "journalLineTaxClassificationId", "authorityType", "authorityId", section, regulation,
           publication, "courtCase", "citationText", "relevanceScore", "createdAt"
    FROM "TaxCitation") c),
  'customers', (SELECT coalesce(json_agg(c ORDER BY c."createdAt"), '[]') FROM (
    SELECT id, "organizationId", "externalId", name, email, phone, "billingAddress", "shippingAddress", "taxExempt",
           "taxExemptNumber", "creditLimit"::text, "paymentTerms", company, "taxId", balance::text, "isActive", notes, "createdAt"
    FROM "Customer") c),
  'invoices', (SELECT coalesce(json_agg(i ORDER BY i."invoiceDate", i."invoiceNumber"), '[]') FROM (
    SELECT id, "organizationId", "customerId", "invoiceNumber", "invoiceDate", "dueDate", status, subtotal::text,
           "taxAmount"::text, "totalAmount"::text, "amountPaid"::text, "amountDue"::text, "discountAmount"::text, "poNumber",
           memo, "sentAt", "paidAt", "voidedAt", "voidReason", terms, notes, "journalId", "stripeInvoiceId", "stripeHostedUrl",
           "createdAt"
    FROM "Invoice") i),
  'invoice_lines', (SELECT coalesce(json_agg(l ORDER BY l."invoiceId", l."lineNumber"), '[]') FROM (
    SELECT id, "invoiceId", "lineNumber", description, quantity::text, "unitPrice"::text, amount::text, "accountId",
           "productId", "discountPercent"::text, "taxRate"::text, "taxAmount"::text, taxable, "createdAt"
    FROM "InvoiceLineItem") l),
  'bank_accounts', (SELECT coalesce(json_agg(b ORDER BY b."createdAt"), '[]') FROM (
    SELECT id, "organizationId", "accountId", "bankName", "accountName", "accountNumber", "routingNumber", "accountType",
           currency, "currentBalance"::text, "availableBalance"::text, "plaidItemId", "plaidAccessToken", "lastSyncAt",
           "isActive", "isPrimary", "createdAt"
    FROM "BankAccount") b),
  'bank_transactions', (SELECT coalesce(json_agg(t ORDER BY t."transactionDate", t.id), '[]') FROM (
    SELECT id, "bankAccountId", "externalId", "transactionDate", "postDate", description, "originalDescription",
           amount::text, "transactionType", category, "merchantName", pending, status, reference, "referenceNumber",
           "categoryAccountId", "customerId", "matchedJournalId", "matchConfidence", "matchMethod",
           "excludeFromReconciliation", metadata, "createdAt"
    FROM "BankTransaction") t),
  'tax_sources', (SELECT coalesce(json_agg(s), '[]') FROM (
    SELECT id, "sourceType", "sourceUrl", "sourceName", "lastCrawled", "lastModified", "contentHash", status, metadata, "createdAt"
    FROM "TaxCorpusSource") s),
  'tax_documents', (SELECT coalesce(json_agg(d), '[]') FROM (
    SELECT id, "sourceId", "documentType", identifier, title, "rawContent", "parsedContent", "effectiveDate",
           "expirationDate", version, "contentHash", status, metadata, "createdAt"
    FROM "TaxDocument") d),
  'tax_sections', (SELECT coalesce(json_agg(s ORDER BY s."documentId", s."sectionNumber"), '[]') FROM (
    SELECT id, "documentId", "sectionNumber", "sectionTitle", "fullPath", "parentId", content, summary, "effectiveDate",
           "expirationDate", "createdAt"
    FROM "TaxSection") s),
  'left_behind', (SELECT coalesce(json_object_agg(t.table_name, t.n), '{}') FROM (
    SELECT table_name, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]::text::int AS n
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name NOT IN (
      '_prisma_migrations', 'Organization', 'OrganizationUser', 'User', 'Account', 'FiscalPeriod', 'Journal', 'JournalLine',
      'JournalLineTaxClassification', 'TaxCitation', 'Customer', 'Invoice', 'InvoiceLineItem', 'BankAccount',
      'BankTransaction', 'TaxCorpusSource', 'TaxDocument', 'TaxSection')) t WHERE t.n > 0)
);
