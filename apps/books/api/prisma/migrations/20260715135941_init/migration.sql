-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('IRC', 'TREASURY_REG', 'IRS_PUBLICATION', 'REVENUE_RULING', 'REVENUE_PROCEDURE', 'IRS_FORM', 'FORM_INSTRUCTION', 'TAX_COURT', 'STATE_CODE');

-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('PENDING', 'CRAWLING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaxCorpusDocumentType" AS ENUM ('STATUTE', 'REGULATION', 'PUBLICATION', 'RULING', 'PROCEDURE', 'FORM', 'INSTRUCTION', 'COURT_OPINION');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('RAW', 'PARSED', 'EXTRACTED', 'CLASSIFIED', 'VALIDATED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('INCLUSION', 'DEDUCTION', 'EXCLUSION', 'CREDIT', 'TIMING', 'LIMITATION', 'PENALTY', 'SAFE_HARBOR', 'ELECTION', 'REPORTING');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('INDIVIDUAL', 'C_CORPORATION', 'S_CORPORATION', 'PARTNERSHIP', 'LLC_PARTNERSHIP', 'LLC_CORPORATION', 'LLC_DISREGARDED', 'SOLE_PROPRIETOR', 'TRUST_SIMPLE', 'TRUST_COMPLEX', 'TRUST_GRANTOR', 'ESTATE', 'NONPROFIT_501C3', 'NONPROFIT_OTHER', 'GOVERNMENT', 'SOLE_PROPRIETORSHIP', 'LLC', 'S_CORP', 'C_CORP', 'NON_PROFIT', 'TRUST');

-- CreateEnum
CREATE TYPE "LimitationType" AS ENUM ('DOLLAR_CAP', 'PERCENTAGE_CAP', 'AGI_PHASEOUT', 'INCOME_LIMIT', 'ACTIVITY_LIMIT', 'CARRYFORWARD_LIMIT', 'CARRYBACK_LIMIT');

-- CreateEnum
CREATE TYPE "ThresholdType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE_OF_AGI', 'PERCENTAGE_OF_INCOME', 'PERCENTAGE_OF_BASIS', 'FORMULA');

-- CreateEnum
CREATE TYPE "FilingStatus" AS ENUM ('SINGLE', 'MARRIED_FILING_JOINTLY', 'MARRIED_FILING_SEPARATELY', 'HEAD_OF_HOUSEHOLD', 'QUALIFYING_WIDOW');

-- CreateEnum
CREATE TYPE "CrossRefType" AS ENUM ('IRC_SECTION', 'TREASURY_REG', 'PUBLICATION', 'RULING', 'FORM', 'COURT_CASE');

-- CreateEnum
CREATE TYPE "CrossRefRelationship" AS ENUM ('IMPLEMENTS', 'EXPLAINS', 'EXCEPTS', 'MODIFIES', 'SUPERSEDES', 'CROSS_REFERENCES', 'CONFLICTS');

-- CreateEnum
CREATE TYPE "ExtractionType" AS ENUM ('SECTION_BOUNDARY', 'HIERARCHY', 'DEFINITION', 'RULE', 'EXCEPTION', 'LIMITATION', 'CROSS_REFERENCE', 'EFFECTIVE_DATE', 'AMOUNT_THRESHOLD');

-- CreateEnum
CREATE TYPE "GraphNodeType" AS ENUM ('IRC_SECTION', 'TREASURY_REG', 'IRS_PUBLICATION', 'REVENUE_RULING', 'IRS_FORM', 'FORM_LINE', 'DEFINITION', 'RULE', 'EXCEPTION', 'THRESHOLD', 'ENTITY_TYPE', 'TRANSACTION_TYPE', 'TAX_TREATMENT');

-- CreateEnum
CREATE TYPE "GraphEdgeType" AS ENUM ('IMPLEMENTS', 'EXPLAINS', 'INTERPRETS', 'REQUIRES', 'MAPS_TO', 'EXCEPTS', 'MODIFIES', 'SUPERSEDES', 'CROSS_REFERENCES', 'APPLIES_TO', 'HAS_LIMITATION', 'HAS_EXCEPTION', 'DEFINES', 'CONFLICTS_WITH');

-- CreateEnum
CREATE TYPE "AccountingMethod" AS ENUM ('CASH', 'ACCRUAL', 'HYBRID');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TaxTreatmentType" AS ENUM ('ORDINARY_INCOME', 'CAPITAL_GAIN_SHORT', 'CAPITAL_GAIN_LONG', 'TAX_EXEMPT', 'DEDUCTIBLE_FULL', 'DEDUCTIBLE_LIMITED', 'NON_DEDUCTIBLE', 'DEFERRED', 'AMORTIZABLE', 'DEPRECIABLE');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('MONTH', 'QUARTER', 'YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSE', 'HARD_CLOSE', 'FUTURE', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'BANK_IMPORT', 'INVOICE', 'BILL', 'PAYROLL', 'DEPRECIATION', 'ADJUSTMENT', 'CLOSING', 'SYSTEM', 'IMPORT', 'PAYMENT', 'RECEIPT', 'BANK_FEED', 'ACCRUAL', 'TAX');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ClassificationMethod" AS ENUM ('AI_AUTO', 'RULE_BASED', 'USER_SPECIFIED', 'CPA_REVIEWED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "DeductionType" AS ENUM ('ABOVE_THE_LINE', 'BELOW_THE_LINE_ITEMIZED', 'BELOW_THE_LINE_STANDARD', 'BUSINESS_EXPENSE', 'CAPITAL_EXPENSE', 'NOT_DEDUCTIBLE');

-- CreateEnum
CREATE TYPE "DeductionLimit" AS ENUM ('NONE', 'FIFTY_PERCENT', 'THIRTY_PERCENT', 'AGI_BASED', 'DOLLAR_CAP', 'HOBBY_LOSS', 'PASSIVE_ACTIVITY', 'AT_RISK');

-- CreateEnum
CREATE TYPE "AuditRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "AuthorityType" AS ENUM ('IRC', 'TREASURY_REG', 'IRS_PUBLICATION', 'REVENUE_RULING', 'REVENUE_PROCEDURE', 'TAX_COURT', 'APPEALS_COURT', 'SUPREME_COURT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID', 'WRITTEN_OFF', 'APPROVED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'MONEY_MARKET', 'LINE_OF_CREDIT');

-- CreateEnum
CREATE TYPE "BankTransactionType" AS ENUM ('DEBIT', 'CREDIT', 'DEPOSIT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'CREATED', 'EXCLUDED', 'RECONCILED', 'PENDING', 'CLEARED');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('EXACT_MATCH', 'FUZZY_MATCH', 'AI_SUGGESTED', 'MANUAL', 'RULE_BASED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'DISCREPANCY', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TaxReturnType" AS ENUM ('FORM_1040', 'FORM_1120', 'FORM_1120S', 'FORM_1065', 'FORM_1041', 'FORM_990', 'STATE_INDIVIDUAL', 'STATE_CORPORATE');

-- CreateEnum
CREATE TYPE "TaxReturnStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'READY_TO_FILE', 'FILED', 'ACCEPTED', 'REJECTED', 'AMENDED');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'VALIDATED', 'ERRORS');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('SCHEDULE_A', 'SCHEDULE_B', 'SCHEDULE_C', 'SCHEDULE_D', 'SCHEDULE_E', 'SCHEDULE_F', 'SCHEDULE_SE', 'SCHEDULE_K1');

-- CreateEnum
CREATE TYPE "EstimatedPaymentStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE');

-- CreateEnum
CREATE TYPE "SafeHarborStatus" AS ENUM ('ON_TRACK', 'BEHIND', 'PENALTY_RISK');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MEALS', 'TRAVEL', 'SUPPLIES', 'UTILITIES', 'EQUIPMENT', 'MAINTENANCE', 'PROFESSIONAL_FEES', 'ENTERTAINMENT', 'TRANSPORTATION', 'TELECOMMUNICATIONS', 'OFFICE_RENT', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryValuationMethod" AS ENUM ('FIFO', 'LIFO', 'WEIGHTED_AVERAGE', 'SPECIFIC_ID');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "StorageDocumentType" AS ENUM ('INVOICE', 'BILL', 'PO', 'ESTIMATE', 'RECEIPT', 'EXPENSE_RECEIPT', 'CONTRACT', 'TAX_FORM', 'STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'SUBMIT', 'POST', 'VOID', 'CONVERT', 'IMPORT', 'EXPORT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'VALIDATING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('INCORRECT_SECTION', 'INCORRECT_TREATMENT', 'MISSING_LIMITATION', 'WRONG_ENTITY_TYPE', 'MISSING_EXCEPTION', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ACCOUNTANT', 'CPA', 'TAX_ATTORNEY', 'ADMIN');

-- CreateEnum
CREATE TYPE "MigrationStatus" AS ENUM ('INITIALIZING', 'EXTRACTING', 'MAPPING', 'IMPORTING', 'CLASSIFYING', 'VALIDATING', 'COMPLETE', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "PaymentGatewayProvider" AS ENUM ('STRIPE', 'SQUARE');

-- CreateEnum
CREATE TYPE "PaymentGatewayStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING_SETUP', 'ERROR');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'ACH', 'WALLET', 'CHECK');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PayFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATING', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "PaycheckStatus" AS ENUM ('PENDING', 'CALCULATED', 'APPROVED', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "PayrollDeductionType" AS ENUM ('FEDERAL_TAX', 'STATE_TAX', 'LOCAL_TAX', 'SOCIAL_SECURITY', 'MEDICARE', 'RETIREMENT_401K', 'RETIREMENT_IRA', 'HEALTH_INSURANCE', 'DENTAL_INSURANCE', 'VISION_INSURANCE', 'LIFE_INSURANCE', 'HSA', 'FSA', 'GARNISHMENT', 'CHILD_SUPPORT', 'UNION_DUES', 'OTHER_PRETAX', 'OTHER_POSTTAX');

-- CreateEnum
CREATE TYPE "W2Status" AS ENUM ('DRAFT', 'GENERATED', 'SENT', 'CORRECTED');

-- CreateEnum
CREATE TYPE "TaxJurisdictionType" AS ENUM ('FEDERAL', 'STATE', 'COUNTY', 'CITY', 'DISTRICT', 'SPECIAL');

-- CreateEnum
CREATE TYPE "TaxFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUALLY', 'SEMIANNUALLY');

-- CreateEnum
CREATE TYPE "TaxLiabilityStatus" AS ENUM ('ACCRUING', 'DUE', 'FILED', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('BUILDING', 'BUILDING_IMPROVEMENT', 'LAND', 'LAND_IMPROVEMENT', 'MACHINERY', 'EQUIPMENT', 'FURNITURE', 'VEHICLE', 'COMPUTER_EQUIPMENT', 'SOFTWARE', 'LEASEHOLD_IMPROVEMENT', 'INTANGIBLE', 'OTHER');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'DOUBLE_DECLINING', 'SUM_OF_YEARS', 'UNITS_OF_PRODUCTION', 'MACRS_GDS', 'MACRS_ADS', 'SECTION_179', 'BONUS_DEPRECIATION', 'NO_DEPRECIATION');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED', 'SOLD', 'WRITTEN_OFF', 'IMPAIRED');

-- CreateEnum
CREATE TYPE "DisposalMethod" AS ENUM ('SALE', 'TRADE_IN', 'SCRAPPED', 'DONATED', 'STOLEN', 'DESTROYED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "BankFeedProvider" AS ENUM ('PLAID', 'YODLEE', 'STRIPE', 'MANUAL');

-- CreateEnum
CREATE TYPE "BankFeedConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'REQUIRES_REAUTH', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "BankFeedSyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "Form1099Type" AS ENUM ('NEC', 'MISC', 'INT', 'DIV', 'B', 'S', 'K', 'R', 'G');

-- CreateEnum
CREATE TYPE "Form1099Status" AS ENUM ('DRAFT', 'GENERATED', 'REVIEWED', 'SENT_TO_RECIPIENT', 'FILED_WITH_IRS', 'ACCEPTED', 'REJECTED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "CreditMemoStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_APPLIED', 'APPLIED', 'VOID');

-- CreateEnum
CREATE TYPE "VendorCreditStatus" AS ENUM ('DRAFT', 'RECEIVED', 'PARTIALLY_APPLIED', 'APPLIED', 'VOID');

-- CreateEnum
CREATE TYPE "RecurringType" AS ENUM ('INVOICE', 'BILL', 'JOURNAL', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'ANNUALLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringTransactionStatus" AS ENUM ('SCHEDULED', 'GENERATED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProjectBillingType" AS ENUM ('FIXED_PRICE', 'TIME_AND_MATERIALS', 'NOT_BILLABLE', 'RETAINER');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'PAID');

-- CreateEnum
CREATE TYPE "EmailTemplateType" AS ENUM ('INVOICE', 'INVOICE_REMINDER', 'INVOICE_OVERDUE', 'STATEMENT', 'ESTIMATE', 'PAYMENT_RECEIPT', 'PAYMENT_THANK_YOU', 'PORTAL_WELCOME', 'PORTAL_PASSWORD_RESET', 'PAYROLL_PAYSTUB', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'FAILED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('DRAFT', 'PRINTED', 'VOIDED', 'CLEARED', 'STALE_DATED', 'PENDING');

-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('BILL_PAYMENT', 'PAYROLL', 'EXPENSE', 'REFUND', 'MANUAL');

-- CreateEnum
CREATE TYPE "BundleType" AS ENUM ('BUNDLE', 'KIT', 'ASSEMBLY');

-- CreateEnum
CREATE TYPE "AssemblyStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ACHBatchStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'RETURNED', 'CANCELLED', 'PENDING', 'GENERATED');

-- CreateEnum
CREATE TYPE "ACHTransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "ACHTransactionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'SETTLED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ACHReturnCode" AS ENUM ('R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R20', 'R21', 'R22', 'R23', 'R24', 'R29', 'R31', 'R33');

-- CreateEnum
CREATE TYPE "EFTPSStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PENDING', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaxPaymentType" AS ENUM ('FEDERAL_941', 'FEDERAL_940', 'FEDERAL_944', 'FEDERAL_945', 'FEDERAL_1042', 'STATE_WITHHOLDING', 'STATE_UNEMPLOYMENT', 'LOCAL_TAX');

-- CreateEnum
CREATE TYPE "MobileDepositStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'ACCEPTED', 'REJECTED', 'FUNDED', 'RETURNED', 'PENDING', 'APPROVED', 'CLEARED');

-- CreateTable
CREATE TABLE "TaxCorpusSource" (
    "id" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceName" TEXT,
    "lastCrawled" TIMESTAMP(3),
    "lastModified" TIMESTAMP(3),
    "contentHash" TEXT,
    "status" "CrawlStatus" NOT NULL DEFAULT 'PENDING',
    "errorLog" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCorpusSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDocument" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentType" "TaxCorpusDocumentType" NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawContent" TEXT NOT NULL,
    "parsedContent" JSONB,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'RAW',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxSection" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sectionNumber" TEXT NOT NULL,
    "sectionTitle" TEXT,
    "fullPath" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "ruleType" "RuleType" NOT NULL,
    "condition" TEXT NOT NULL,
    "consequence" TEXT NOT NULL,
    "category" TEXT,
    "summary" TEXT,
    "ruleText" TEXT,
    "applicableTo" "EntityType"[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "extractionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDefinition" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "scope" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxException" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "exceptionType" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "sectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxLimitation" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "limitationType" "LimitationType" NOT NULL,
    "thresholdType" "ThresholdType" NOT NULL,
    "thresholdValue" DECIMAL(19,4),
    "thresholdFormula" TEXT,
    "thresholdPercentage" DECIMAL(19,4),
    "description" TEXT,
    "phaseoutStart" DECIMAL(19,4),
    "phaseoutEnd" DECIMAL(19,4),
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "sectionId" TEXT,
    "filingStatuses" "FilingStatus"[],
    "taxYearStart" INTEGER,
    "taxYearEnd" INTEGER,
    "indexedForInflation" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxLimitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCrossReference" (
    "id" TEXT NOT NULL,
    "sourceSectionId" TEXT NOT NULL,
    "targetIdentifier" TEXT NOT NULL,
    "targetType" "CrossRefType" NOT NULL,
    "relationship" "CrossRefRelationship" NOT NULL,
    "referenceType" TEXT,
    "targetSectionId" TEXT,
    "context" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCrossReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxExtraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sectionId" TEXT,
    "extractionType" "ExtractionType" NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "rawOutput" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "humanReviewed" BOOLEAN NOT NULL DEFAULT false,
    "humanApproved" BOOLEAN,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxGraphNode" (
    "id" TEXT NOT NULL,
    "nodeType" "GraphNodeType" NOT NULL,
    "identifier" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxGraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxGraphEdge" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "edgeType" "GraphEdgeType" NOT NULL,
    "properties" JSONB,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxGraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "taxId" TEXT,
    "fiscalYearEnd" INTEGER NOT NULL DEFAULT 12,
    "accountingMethod" "AccountingMethod" NOT NULL DEFAULT 'ACCRUAL',
    "industry" TEXT,
    "stateOfIncorporation" TEXT,
    "address" JSONB,
    "settings" JSONB,
    "legalName" TEXT,
    "naicsCode" TEXT,
    "defaultCurrency" TEXT DEFAULT 'USD',
    "subscriptionTier" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accountType" "AccountType" NOT NULL,
    "accountSubtype" TEXT,
    "normalBalance" "NormalBalance" NOT NULL,
    "taxCode" TEXT,
    "currency" TEXT DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBankAccount" BOOLEAN NOT NULL DEFAULT false,
    "isSystemAccount" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountTaxMapping" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "primaryIrcSection" TEXT,
    "defaultTreatment" "TaxTreatmentType",
    "scheduleMapping" TEXT,
    "form1099Type" TEXT,
    "requiresTracking" BOOLEAN NOT NULL DEFAULT false,
    "trackingType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountTaxMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "periodNumber" INTEGER NOT NULL DEFAULT 0,
    "fiscalYear" INTEGER,
    "name" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT,
    "journalNumber" TEXT NOT NULL,
    "journalDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "sourceType" "JournalSource" NOT NULL,
    "sourceId" TEXT,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "type" TEXT,
    "tags" TEXT[],
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedBy" TEXT,
    "isAdjusting" BOOLEAN NOT NULL DEFAULT false,
    "isReversing" BOOLEAN NOT NULL DEFAULT false,
    "reversesJournalId" TEXT,
    "reversedByJournalId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "memo" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "taxCode" TEXT,
    "quantity" DECIMAL(19,4),
    "unitPrice" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "classId" TEXT,
    "locationId" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionTaxClassification" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "classificationMethod" "ClassificationMethod" NOT NULL,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionTaxClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLineTaxClassification" (
    "id" TEXT NOT NULL,
    "journalLineId" TEXT NOT NULL,
    "transactionClassificationId" TEXT,
    "taxTreatment" "TaxTreatmentType",
    "ircSection" TEXT,
    "regulationRef" TEXT,
    "deductionType" "DeductionType",
    "deductionLimit" "DeductionLimit",
    "limitedAmount" DECIMAL(19,4),
    "disallowedAmount" DECIMAL(19,4),
    "carryforwardAmount" DECIMAL(19,4),
    "recognitionYear" INTEGER,
    "isDeferral" BOOLEAN NOT NULL DEFAULT false,
    "deferralEndYear" INTEGER,
    "requiredDocs" TEXT[],
    "hasRequiredDocs" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL,
    "auditRiskLevel" "AuditRiskLevel" NOT NULL DEFAULT 'LOW',
    "auditRiskFactors" TEXT[],
    "category" TEXT,
    "classifiedAt" TIMESTAMP(3),
    "deductibility" TEXT,
    "deductiblePercentage" DOUBLE PRECISION,
    "explanation" TEXT,
    "formPlacement" JSONB,
    "isManualOverride" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalLineTaxClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCitation" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT,
    "journalLineTaxClassificationId" TEXT,
    "authorityType" "AuthorityType",
    "authorityId" TEXT,
    "section" TEXT,
    "regulation" TEXT,
    "publication" TEXT,
    "courtCase" TEXT,
    "citationText" TEXT,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "billingAddress" JSONB,
    "shippingAddress" JSONB,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "taxExemptNumber" TEXT,
    "creditLimit" DECIMAL(19,4),
    "paymentTerms" INTEGER,
    "company" TEXT,
    "taxId" TEXT,
    "balance" DECIMAL(19,4),
    "isActive" BOOLEAN DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL,
    "amountPaid" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(19,4) NOT NULL,
    "discountAmount" DECIMAL(19,4),
    "poNumber" TEXT,
    "memo" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "terms" TEXT,
    "notes" TEXT,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "accountId" TEXT,
    "productId" TEXT,
    "discountPercent" DECIMAL(19,4),
    "taxRate" DECIMAL(19,4),
    "taxAmount" DECIMAL(19,4),
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "classId" TEXT,
    "locationId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" TEXT,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" JSONB,
    "taxId" TEXT,
    "requires1099" BOOLEAN NOT NULL DEFAULT false,
    "vendor1099Type" TEXT,
    "paymentTerms" INTEGER,
    "company" TEXT,
    "balance" DECIMAL(19,4),
    "isActive" BOOLEAN DEFAULT true,
    "defaultExpenseAccountId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL,
    "amountPaid" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(19,4) NOT NULL,
    "balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "vendorInvoiceNumber" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "journalId" TEXT,
    "attachments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillLineItem" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "accountId" TEXT,
    "taxRate" DECIMAL(19,4),
    "taxAmount" DECIMAL(19,4),
    "taxClassificationOverride" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "classId" TEXT,
    "locationId" TEXT,

    CONSTRAINT "BillLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "routingNumber" TEXT,
    "accountType" "BankAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "currentBalance" DECIMAL(19,4) NOT NULL,
    "availableBalance" DECIMAL(19,4),
    "plaidItemId" TEXT,
    "plaidAccessToken" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "externalId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "postDate" TIMESTAMP(3),
    "description" TEXT,
    "originalDescription" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "transactionType" "BankTransactionType" NOT NULL,
    "category" TEXT,
    "merchantName" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "reference" TEXT,
    "referenceNumber" TEXT,
    "categoryAccountId" TEXT,
    "vendorId" TEXT,
    "customerId" TEXT,
    "matchedJournalId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "matchMethod" "MatchMethod",
    "excludeFromReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "statementBalance" DECIMAL(19,4) NOT NULL,
    "glBalance" DECIMAL(19,4),
    "reconciledBalance" DECIMAL(19,4),
    "beginningBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "clearedBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "difference" DECIMAL(19,4) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "returnType" "TaxReturnType" NOT NULL,
    "filingStatus" "FilingStatus",
    "status" "TaxReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "extendedDueDate" TIMESTAMP(3),
    "filedDate" TIMESTAMP(3),
    "acceptedDate" TIMESTAMP(3),
    "grossIncome" DECIMAL(19,4),
    "adjustments" DECIMAL(19,4),
    "agi" DECIMAL(19,4),
    "deductions" DECIMAL(19,4),
    "taxableIncome" DECIMAL(19,4),
    "taxLiability" DECIMAL(19,4),
    "credits" DECIMAL(19,4),
    "paymentsWithheld" DECIMAL(19,4),
    "estimatedPayments" DECIMAL(19,4),
    "amountDue" DECIMAL(19,4),
    "refundAmount" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxForm" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "formType" TEXT NOT NULL,
    "formVersion" TEXT NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "data" JSONB NOT NULL,
    "computedFields" JSONB,
    "validationErrors" JSONB,
    "sourceLineMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxSchedule" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "scheduleType" "ScheduleType" NOT NULL,
    "data" JSONB NOT NULL,
    "computedTotals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimatedPayment" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "requiredAmount" DECIMAL(19,4) NOT NULL,
    "paidAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "paidDate" TIMESTAMP(3),
    "status" "EstimatedPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimatedPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "ytdGrossIncome" DECIMAL(19,4) NOT NULL,
    "ytdAdjustments" DECIMAL(19,4) NOT NULL,
    "projectedAGI" DECIMAL(19,4) NOT NULL,
    "ytdDeductions" DECIMAL(19,4) NOT NULL,
    "projectedDeductions" DECIMAL(19,4) NOT NULL,
    "ytdTaxLiability" DECIMAL(19,4) NOT NULL,
    "projectedTaxLiability" DECIMAL(19,4) NOT NULL,
    "ytdWithholding" DECIMAL(19,4) NOT NULL,
    "ytdEstimatedPayments" DECIMAL(19,4) NOT NULL,
    "projectedAmountDue" DECIMAL(19,4) NOT NULL,
    "safeHarborRequired" DECIMAL(19,4) NOT NULL,
    "safeHarborStatus" "SafeHarborStatus" NOT NULL,
    "q1Required" DECIMAL(19,4) NOT NULL,
    "q2Required" DECIMAL(19,4) NOT NULL,
    "q3Required" DECIMAL(19,4) NOT NULL,
    "q4Required" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "estimateNumber" TEXT NOT NULL,
    "estimateDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "subject" TEXT,
    "description" TEXT,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(12,8) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "terms" TEXT,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "convertedToInvoiceId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLineItem" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(12,8) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "terms" TEXT,
    "shippingAddress" JSONB,
    "sentAt" TIMESTAMP(3),
    "acknowledgmentId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POLineItem" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "receivedQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GRLineItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "poLineItemId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "cost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GRLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expenseNumber" TEXT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "category" "ExpenseCategory",
    "description" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(12,8) NOT NULL DEFAULT 1,
    "accountId" TEXT,
    "vendorId" TEXT,
    "employeeId" TEXT,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "tags" TEXT[],
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unitCost" DECIMAL(19,4) NOT NULL,
    "sellingPrice" DECIMAL(19,4) NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "reorderPoint" DECIMAL(12,4) NOT NULL,
    "valuationMethod" "InventoryValuationMethod" NOT NULL DEFAULT 'FIFO',
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "referenceId" TEXT,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(19,4) NOT NULL,
    "totalCost" DECIMAL(19,4) NOT NULL,
    "balanceQty" DECIMAL(12,4) NOT NULL,
    "balanceCost" DECIMAL(19,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(12,8) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetName" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "period" "BudgetPeriod" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLineItem" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "budgetAmount" DECIMAL(19,4) NOT NULL,
    "actualAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "forecastAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "type" TEXT,
    "amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "department" TEXT,
    "jobTitle" TEXT,
    "hourlyRate" DECIMAL(12,4),
    "salary" DECIMAL(19,4),
    "taxId" TEXT,
    "address" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "weekEndDate" TIMESTAMP(3) NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "hours" DECIMAL(10,2),
    "hourlyRate" DECIMAL(12,4),
    "projectId" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEntry" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "billingRate" DECIMAL(12,4),
    "invoiced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "taskName" TEXT,
    "name" TEXT,
    "description" TEXT,
    "employeeId" TEXT,
    "assignedTo" TEXT,
    "priority" TEXT,
    "estimatedHours" DECIMAL(10,2),
    "actualHours" DECIMAL(10,2),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" "StorageDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "relatedEntityId" TEXT,
    "relatedEntityType" TEXT,
    "metadata" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTrailEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actionType" "AuditActionType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "changes" JSONB,
    "ipAddress" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditTrailEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "errors" JSONB,
    "mappingConfig" JSONB,
    "importedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "errors" JSONB,
    "createdEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationFeedback" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT,
    "journalLineTaxClassificationId" TEXT,
    "originalCategory" TEXT,
    "suggestedCategory" TEXT,
    "isCorrect" BOOLEAN,
    "notes" TEXT,
    "createdBy" TEXT,
    "feedbackType" "FeedbackType",
    "originalClassification" JSONB,
    "correctedClassification" JSONB,
    "correctionReason" TEXT,
    "submittedBy" TEXT,
    "submittedByRole" "UserRole",
    "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "appliedToModel" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassificationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "status" "MigrationStatus" NOT NULL DEFAULT 'INITIALIZING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentPhase" TEXT,
    "stats" JSONB,
    "errors" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentGateway" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "PaymentGatewayStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "publicKey" TEXT,
    "secretKeyEncrypted" TEXT,
    "webhookSecret" TEXT,
    "merchantId" TEXT,
    "locationId" TEXT,
    "accountId" TEXT,
    "settings" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "cardExpMonth" INTEGER,
    "cardExpYear" INTEGER,
    "bankName" TEXT,
    "accountLast4" TEXT,
    "accountType" TEXT,
    "routingNumber" TEXT,
    "stripePaymentMethodId" TEXT,
    "squareCardId" TEXT,
    "billingAddress" JSONB,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "invoiceId" TEXT,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "providerTransactionId" TEXT,
    "providerFee" DECIMAL(19,4),
    "netAmount" DECIMAL(19,4),
    "description" TEXT,
    "statementDescriptor" TEXT,
    "receiptUrl" TEXT,
    "receiptNumber" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "reason" TEXT,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payFrequency" "PayFrequency" NOT NULL DEFAULT 'BIWEEKLY',
    "defaultPayDay" INTEGER NOT NULL DEFAULT 5,
    "federalEIN" TEXT,
    "stateEINs" JSONB,
    "federalDepositSchedule" TEXT,
    "payrollBankAccountId" TEXT,
    "directDepositEnabled" BOOLEAN NOT NULL DEFAULT false,
    "overtimeThreshold" DECIMAL(10,2) NOT NULL DEFAULT 40,
    "overtimeMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "federalTaxTableYear" INTEGER,
    "stateTaxTableYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "totalGrossPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalTaxes" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalNetPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalEmployerTaxes" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "journalId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paycheck" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "checkNumber" TEXT,
    "status" "PaycheckStatus" NOT NULL DEFAULT 'PENDING',
    "regularHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ptoHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "holidayHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sickHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "regularRate" DECIMAL(12,4) NOT NULL,
    "overtimeRate" DECIMAL(12,4),
    "regularPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "overtimePay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ptoPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "holidayPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "sickPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bonusPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "commissionPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "otherEarnings" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalTaxes" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CHECK',
    "bankAccountId" TEXT,
    "federalTax" DECIMAL(19,4),
    "socialSecurityTax" DECIMAL(19,4),
    "medicareTax" DECIMAL(19,4),
    "additionalMedicareTax" DECIMAL(19,4),
    "ytdGrossPay" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ytdFederalTax" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ytdStateTax" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ytdSocialSecurity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ytdMedicare" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "memo" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paycheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaycheckDeduction" (
    "id" TEXT NOT NULL,
    "paycheckId" TEXT NOT NULL,
    "type" "PayrollDeductionType" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "isPreTax" BOOLEAN NOT NULL DEFAULT true,
    "isEmployerMatch" BOOLEAN NOT NULL DEFAULT false,
    "employerMatchAmount" DECIMAL(19,4),
    "ytdAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaycheckDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaycheckTax" (
    "id" TEXT NOT NULL,
    "paycheckId" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "taxableWages" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL,
    "employerAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ytdTaxableWages" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ytdTaxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaycheckTax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDeductionSetup" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "PayrollDeductionType" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(19,4),
    "percentage" DECIMAL(5,4),
    "isPercentage" BOOLEAN NOT NULL DEFAULT false,
    "isPreTax" BOOLEAN NOT NULL DEFAULT true,
    "hasEmployerMatch" BOOLEAN NOT NULL DEFAULT false,
    "employerMatchPercent" DECIMAL(5,4),
    "employerMatchLimit" DECIMAL(19,4),
    "annualLimit" DECIMAL(19,4),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDeductionSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "W2Form" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "status" "W2Status" NOT NULL DEFAULT 'DRAFT',
    "wagesTipsOther" DECIMAL(19,4) NOT NULL,
    "federalTaxWithheld" DECIMAL(19,4) NOT NULL,
    "socialSecurityWages" DECIMAL(19,4) NOT NULL,
    "socialSecurityTax" DECIMAL(19,4) NOT NULL,
    "medicareWages" DECIMAL(19,4) NOT NULL,
    "medicareTax" DECIMAL(19,4) NOT NULL,
    "socialSecurityTips" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "allocatedTips" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "dependentCareBenefits" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "nonqualifiedPlans" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "box12Data" JSONB,
    "statutoryEmployee" BOOLEAN NOT NULL DEFAULT false,
    "retirementPlan" BOOLEAN NOT NULL DEFAULT false,
    "thirdPartySickPay" BOOLEAN NOT NULL DEFAULT false,
    "other" JSONB,
    "stateWages" JSONB,
    "localWages" JSONB,
    "controlNumber" TEXT,
    "generatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentMethod" TEXT,
    "correctedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "W2Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTaxRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "jurisdictionType" "TaxJurisdictionType" NOT NULL,
    "rate" DECIMAL(8,6) NOT NULL,
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "zipCodes" TEXT[],
    "countyFips" TEXT,
    "stateFips" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxAgency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "jurisdictionType" "TaxJurisdictionType" NOT NULL,
    "filingFrequency" "TaxFilingFrequency" NOT NULL,
    "accountNumber" TEXT,
    "filingMethod" TEXT,
    "paymentMethod" TEXT,
    "dueDayOfMonth" INTEGER,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "liabilityAccountId" TEXT,
    "expenseAccountId" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "mailingAddress" JSONB,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxAgency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTaxLiability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "taxRateId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "taxableSales" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "exemptSales" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxCollected" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "status" "TaxLiabilityStatus" NOT NULL DEFAULT 'ACCRUING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "journalId" TEXT,
    "paymentJournalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTaxLiability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTaxFiling" (
    "id" TEXT NOT NULL,
    "liabilityId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "filedDate" TIMESTAMP(3) NOT NULL,
    "filedBy" TEXT NOT NULL,
    "filingMethod" TEXT NOT NULL,
    "confirmationNumber" TEXT,
    "paymentDate" TIMESTAMP(3),
    "paymentAmount" DECIMAL(19,4),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "formData" JSONB,
    "attachments" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTaxFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTaxability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taxRateId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "productCategory" TEXT,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "isExempt" BOOLEAN NOT NULL DEFAULT false,
    "exemptionCode" TEXT,
    "exemptionReason" TEXT,
    "specialRate" DECIMAL(8,6),
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTaxability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assetType" "AssetType" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" DECIMAL(19,4) NOT NULL,
    "acquisitionMethod" TEXT,
    "vendorId" TEXT,
    "purchaseOrderId" TEXT,
    "invoiceNumber" TEXT,
    "location" TEXT,
    "department" TEXT,
    "assignedTo" TEXT,
    "serialNumber" TEXT,
    "modelNumber" TEXT,
    "manufacturer" TEXT,
    "warrantyExpiration" TIMESTAMP(3),
    "warrantyNotes" TEXT,
    "insuredValue" DECIMAL(19,4),
    "insurancePolicy" TEXT,
    "currentBookValue" DECIMAL(19,4) NOT NULL,
    "accumulatedDepreciation" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAssetAccount" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetAccountId" TEXT NOT NULL,
    "accumulatedDepAccountId" TEXT NOT NULL,
    "depreciationExpenseAccountId" TEXT NOT NULL,
    "gainLossAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAssetAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationSchedule" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "method" "DepreciationMethod" NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "salvageValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxMethod" "DepreciationMethod",
    "taxUsefulLifeMonths" INTEGER,
    "taxSalvageValue" DECIMAL(19,4),
    "macrsClass" TEXT,
    "macrsConvention" TEXT,
    "section179Amount" DECIMAL(19,4),
    "bonusDepreciation" DECIMAL(19,4),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "priorDepreciation" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCalculatedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepreciationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationEntry" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "periodDate" TIMESTAMP(3) NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "depreciationAmount" DECIMAL(19,4) NOT NULL,
    "accumulatedTotal" DECIMAL(19,4) NOT NULL,
    "bookValue" DECIMAL(19,4) NOT NULL,
    "taxDepreciation" DECIMAL(19,4),
    "taxAccumulated" DECIMAL(19,4),
    "taxBookValue" DECIMAL(19,4),
    "journalId" TEXT,
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "calculationMethod" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepreciationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDisposal" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "disposalDate" TIMESTAMP(3) NOT NULL,
    "disposalMethod" "DisposalMethod" NOT NULL,
    "salePrice" DECIMAL(19,4),
    "saleExpenses" DECIMAL(19,4),
    "netProceeds" DECIMAL(19,4),
    "buyerName" TEXT,
    "buyerContact" JSONB,
    "bookValueAtDisposal" DECIMAL(19,4) NOT NULL,
    "accumulatedDepAtDisposal" DECIMAL(19,4) NOT NULL,
    "gainLoss" DECIMAL(19,4) NOT NULL,
    "isOrdinaryIncome" BOOLEAN NOT NULL DEFAULT false,
    "tradeInAssetId" TEXT,
    "tradeInAllowance" DECIMAL(19,4),
    "journalId" TEXT,
    "notes" TEXT,
    "attachments" TEXT[],
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetDisposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankFeedConnection" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "provider" "BankFeedProvider" NOT NULL,
    "status" "BankFeedConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "plaidItemId" TEXT,
    "plaidAccessToken" TEXT,
    "plaidAccountId" TEXT,
    "yodleeAccountId" TEXT,
    "yodleeProviderAccountId" TEXT,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "institutionLogo" TEXT,
    "lastSuccessfulSync" TIMESTAMP(3),
    "lastAttemptedSync" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "syncFrequencyHours" INTEGER NOT NULL DEFAULT 24,
    "syncHistoryDays" INTEGER NOT NULL DEFAULT 90,
    "consentExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankFeedConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankFeedSync" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" "BankFeedSyncStatus" NOT NULL DEFAULT 'PENDING',
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "transactionsFound" INTEGER NOT NULL DEFAULT 0,
    "transactionsNew" INTEGER NOT NULL DEFAULT 0,
    "transactionsUpdated" INTEGER NOT NULL DEFAULT 0,
    "transactionsDuplicate" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "providerCursor" TEXT,
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankFeedSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankFeedRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "descriptionContains" TEXT,
    "descriptionPattern" TEXT,
    "matchPattern" TEXT,
    "matchType" TEXT,
    "merchantName" TEXT,
    "minAmount" DECIMAL(19,4),
    "maxAmount" DECIMAL(19,4),
    "transactionType" "BankTransactionType",
    "accountId" TEXT,
    "categoryAccountId" TEXT,
    "taxClassification" TEXT,
    "vendorId" TEXT,
    "customerId" TEXT,
    "classId" TEXT,
    "locationId" TEXT,
    "memo" TEXT,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "autoCreateJournal" BOOLEAN NOT NULL DEFAULT false,
    "autoMatch" BOOLEAN NOT NULL DEFAULT true,
    "timesMatched" INTEGER NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankFeedRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form1099" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "formType" "Form1099Type" NOT NULL,
    "status" "Form1099Status" NOT NULL DEFAULT 'DRAFT',
    "recipientName" TEXT NOT NULL,
    "recipientTin" TEXT,
    "recipientTinType" TEXT,
    "recipientAddress" JSONB NOT NULL,
    "payerName" TEXT NOT NULL,
    "payerTin" TEXT NOT NULL,
    "payerAddress" JSONB NOT NULL,
    "formNumber" TEXT,
    "correctedFormId" TEXT,
    "isVoid" BOOLEAN NOT NULL DEFAULT false,
    "totalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "federalTaxWithheld" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "stateTaxWithheld" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "stateCode" TEXT,
    "stateIdNumber" TEXT,
    "stateIncome" DECIMAL(19,4),
    "generatedAt" TIMESTAMP(3),
    "sentToRecipientAt" TIMESTAMP(3),
    "filedWithIrsAt" TIMESTAMP(3),
    "irsSubmissionId" TEXT,
    "irsAcceptedAt" TIMESTAMP(3),
    "irsRejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form1099_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form1099Line" (
    "id" TEXT NOT NULL,
    "form1099Id" TEXT NOT NULL,
    "boxNumber" TEXT NOT NULL,
    "boxLabel" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form1099Line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form1099Filing" (
    "id" TEXT NOT NULL,
    "form1099Id" TEXT NOT NULL,
    "filingType" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "filedBy" TEXT NOT NULL,
    "confirmationNumber" TEXT,
    "transmissionId" TEXT,
    "transmissionStatus" TEXT,
    "transmissionResponse" JSONB,
    "trackingNumber" TEXT,
    "mailedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "documentPath" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form1099Filing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditMemo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "creditNumber" TEXT NOT NULL,
    "creditDate" TIMESTAMP(3) NOT NULL,
    "status" "CreditMemoStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL,
    "appliedAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "remainingAmount" DECIMAL(19,4) NOT NULL,
    "originalInvoiceId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "journalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditMemo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditMemoLine" (
    "id" TEXT NOT NULL,
    "creditMemoId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "classId" TEXT,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditMemoLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditMemoApplication" (
    "id" TEXT NOT NULL,
    "creditMemoId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "appliedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditMemoApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCredit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "creditNumber" TEXT NOT NULL,
    "creditDate" TIMESTAMP(3) NOT NULL,
    "vendorCreditNumber" TEXT,
    "status" "VendorCreditStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL,
    "appliedAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "remainingAmount" DECIMAL(19,4) NOT NULL,
    "originalBillId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "journalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCreditLine" (
    "id" TEXT NOT NULL,
    "vendorCreditId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "classId" TEXT,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCreditLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCreditApplication" (
    "id" TEXT NOT NULL,
    "vendorCreditId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "appliedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorCreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RecurringType" NOT NULL,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "templateData" JSONB NOT NULL,
    "customerId" TEXT,
    "vendorId" TEXT,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "notifyBeforeDays" INTEGER,
    "notifyOnCreation" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "monthOfYear" INTEGER,
    "customPattern" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "maxOccurrences" INTEGER,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "lastRunDate" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "endAfterAmount" DECIMAL(19,4),
    "totalGenerated" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTransaction" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "status" "RecurringTransactionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "generatedEntityType" TEXT,
    "generatedEntityId" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "skippedAt" TIMESTAMP(3),
    "skippedBy" TEXT,
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fullPath" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "address" JSONB,
    "phone" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fullPath" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "defaultTaxRateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "projectNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "billingType" "ProjectBillingType" NOT NULL DEFAULT 'TIME_AND_MATERIALS',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "budgetAmount" DECIMAL(19,4),
    "budgetHours" DECIMAL(10,2),
    "defaultHourlyRate" DECIMAL(12,4),
    "markupPercent" DECIMAL(5,2),
    "fixedPriceAmount" DECIMAL(19,4),
    "retainerAmount" DECIMAL(19,4),
    "retainerFrequency" TEXT,
    "totalBudget" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalBilled" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "billableHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "actualHours" DECIMAL(10,2),
    "actualCost" DECIMAL(19,4),
    "actualRevenue" DECIMAL(19,4),
    "billRate" DECIMAL(12,4),
    "completedAt" TIMESTAMP(3),
    "classId" TEXT,
    "locationId" TEXT,
    "managerId" TEXT,
    "notes" TEXT,
    "tags" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudgetLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accountId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "budgetAmount" DECIMAL(19,4) NOT NULL,
    "actualAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "variance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "percentUsed" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTimeEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "taskId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "hourlyRate" DECIMAL(12,4),
    "amount" DECIMAL(19,4),
    "costRate" DECIMAL(12,4),
    "costAmount" DECIMAL(19,4),
    "isInvoiced" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "timesheetEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "expenseId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "category" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "markupPercent" DECIMAL(5,2),
    "billableAmount" DECIMAL(19,4),
    "isInvoiced" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "hasReceipt" BOOLEAN NOT NULL DEFAULT false,
    "receiptPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressInvoice" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "percentComplete" DECIMAL(5,2) NOT NULL,
    "previousBilled" DECIMAL(19,4) NOT NULL,
    "currentBilled" DECIMAL(19,4) NOT NULL,
    "totalBilled" DECIMAL(19,4) NOT NULL,
    "remainingAmount" DECIMAL(19,4) NOT NULL,
    "retentionPercent" DECIMAL(5,2),
    "retentionAmount" DECIMAL(19,4),
    "retentionReleased" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressMilestone" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sequenceNumber" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "percentOfTotal" DECIMAL(5,2) NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completedDate" TIMESTAMP(3),
    "invoiceId" TEXT,
    "invoicedAmount" DECIMAL(19,4),
    "invoicedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "statementNumber" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(19,4) NOT NULL,
    "totalCharges" DECIMAL(19,4) NOT NULL,
    "totalPayments" DECIMAL(19,4) NOT NULL,
    "totalCredits" DECIMAL(19,4) NOT NULL,
    "closingBalance" DECIMAL(19,4) NOT NULL,
    "current" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "days1to30" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "days31to60" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "days61to90" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "over90" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "sentMethod" TEXT,
    "viewedAt" TIMESTAMP(3),
    "documentPath" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "balance" DECIMAL(19,4) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "customerId" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "accessToken" TEXT,
    "accessUrl" TEXT,
    "allowInvoiceView" BOOLEAN DEFAULT true,
    "allowPayments" BOOLEAN DEFAULT true,
    "allowEstimates" BOOLEAN DEFAULT true,
    "allowDocuments" BOOLEAN DEFAULT true,
    "lastAccessedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpires" TIMESTAMP(3),
    "receiveEmailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalInvoiceView" (
    "id" TEXT NOT NULL,
    "portalAccessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "PortalInvoiceView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "EmailTemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT,
    "availableFields" TEXT[],
    "fromName" TEXT,
    "replyTo" TEXT,
    "ccAddresses" TEXT[],
    "bccAddresses" TEXT[],
    "attachPdf" BOOLEAN NOT NULL DEFAULT true,
    "attachmentTypes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateType" "EmailTemplateType",
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "replyTo" TEXT,
    "ccEmails" TEXT[],
    "bccEmails" TEXT[],
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "attachments" JSONB,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "providerId" TEXT,
    "providerResponse" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "bankAccountId" TEXT,
    "paperSize" TEXT NOT NULL DEFAULT 'LETTER',
    "checkPosition" TEXT NOT NULL DEFAULT 'TOP',
    "checksPerPage" INTEGER NOT NULL DEFAULT 3,
    "datePosition" JSONB,
    "payeePosition" JSONB,
    "amountPosition" JSONB,
    "amountWordsPosition" JSONB,
    "memoPosition" JSONB,
    "signaturePosition" JSONB,
    "includeVoucher" BOOLEAN DEFAULT true,
    "payeeNameX" INTEGER,
    "payeeNameY" INTEGER,
    "amountNumericX" INTEGER,
    "amountNumericY" INTEGER,
    "amountWordsX" INTEGER,
    "amountWordsY" INTEGER,
    "dateX" INTEGER,
    "dateY" INTEGER,
    "memoX" INTEGER,
    "memoY" INTEGER,
    "signatureLineX" INTEGER,
    "signatureLineY" INTEGER,
    "logoUrl" TEXT,
    "customCss" TEXT,
    "micrPosition" JSONB,
    "micrFont" TEXT NOT NULL DEFAULT 'E13B',
    "includeStub" BOOLEAN NOT NULL DEFAULT true,
    "stubPosition" TEXT,
    "stubFields" JSONB,
    "logoPath" TEXT,
    "logoPosition" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckPrint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "checkNumber" INTEGER NOT NULL,
    "checkDate" TIMESTAMP(3) NOT NULL,
    "checkType" "CheckType",
    "status" "CheckStatus" NOT NULL DEFAULT 'DRAFT',
    "payeeType" TEXT NOT NULL,
    "payeeId" TEXT,
    "payeeName" TEXT NOT NULL,
    "payeeAddress" JSONB,
    "amount" DECIMAL(19,4) NOT NULL,
    "amountInWords" TEXT,
    "amountWords" TEXT,
    "billId" TEXT,
    "memo" TEXT,
    "vendorPaymentId" TEXT,
    "paycheckId" TEXT,
    "expenseId" TEXT,
    "refundId" TEXT,
    "printedAt" TIMESTAMP(3),
    "printedBy" TEXT,
    "printerName" TEXT,
    "batchId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearedAmount" DECIMAL(19,4),
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckPrint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchNumber" TEXT,
    "bankAccountId" TEXT,
    "templateId" TEXT,
    "startingCheckNum" TEXT,
    "endingCheckNum" TEXT,
    "startingCheckNumber" INTEGER,
    "endingCheckNumber" INTEGER,
    "totalChecks" INTEGER,
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "printedAt" TIMESTAMP(3),
    "printedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBundle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bundleType" "BundleType" NOT NULL DEFAULT 'BUNDLE',
    "sellingPrice" DECIMAL(19,4) NOT NULL,
    "totalComponentCost" DECIMAL(19,4),
    "pricingMethod" TEXT NOT NULL DEFAULT 'FIXED',
    "marginPercent" DECIMAL(5,2),
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "quantityOnHand" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "reorderPoint" DECIMAL(12,4),
    "incomeAccountId" TEXT,
    "cogsAccountId" TEXT,
    "assetAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBundleItem" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCostAtCreation" DECIMAL(19,4),
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "priceOverride" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBundleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyBuild" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "buildNumber" TEXT,
    "buildDate" TIMESTAMP(3) NOT NULL,
    "status" "AssemblyStatus" NOT NULL DEFAULT 'PENDING',
    "quantityToBuild" DECIMAL(12,4),
    "quantityBuilt" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "componentCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "journalId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyBuildItem" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantityRequired" DECIMAL(12,4),
    "quantityUsed" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(19,4) NOT NULL,
    "totalCost" DECIMAL(19,4) NOT NULL,
    "lotNumber" TEXT,
    "serialNumbers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyBuildItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeBankAccount" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'CHECKING',
    "bankName" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "nameOnAccount" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verificationMethod" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT,
    "depositType" TEXT NOT NULL DEFAULT 'FULL',
    "depositAmount" DECIMAL(19,4),
    "depositPercent" DECIMAL(5,2),
    "prenoteStatus" TEXT,
    "prenoteSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ACHBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "batchType" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyEntryDesc" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "settlementDate" TIMESTAMP(3),
    "originatingDFI" TEXT,
    "bankAccountId" TEXT NOT NULL,
    "createdBy" TEXT,
    "nachaFileContent" TEXT,
    "generatedAt" TIMESTAMP(3),
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "totalCredits" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalDebits" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "status" "ACHBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "fileId" TEXT,
    "fileCreatedAt" TIMESTAMP(3),
    "fileHash" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "returnCount" INTEGER NOT NULL DEFAULT 0,
    "returnAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ACHBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ACHTransaction" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "transactionType" "ACHTransactionType" NOT NULL,
    "status" "ACHTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "receiverType" TEXT NOT NULL,
    "receiverId" TEXT,
    "receiverName" TEXT NOT NULL,
    "employeeBankAccountId" TEXT,
    "routingNumber" TEXT,
    "accountNumber" TEXT,
    "accountType" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "traceNumber" TEXT,
    "individualId" TEXT,
    "addendaRecord" TEXT,
    "processedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnCode" "ACHReturnCode",
    "returnReason" TEXT,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "reversalOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ACHTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollTaxFiling" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payrollRunId" TEXT,
    "filingType" "TaxPaymentType",
    "filingFrequency" TEXT,
    "taxYear" INTEGER,
    "taxPeriod" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "totalWages" DECIMAL(19,4),
    "federalWithholding" DECIMAL(19,4) NOT NULL,
    "socialSecurityTax" DECIMAL(19,4) NOT NULL,
    "medicareTax" DECIMAL(19,4) NOT NULL,
    "additionalMedicare" DECIMAL(19,4),
    "federalUnemployment" DECIMAL(19,4),
    "form941Liability" DECIMAL(19,4),
    "totalTaxDue" DECIMAL(19,4) NOT NULL,
    "depositsThisPeriod" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(19,4),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "filedAt" TIMESTAMP(3),
    "filedBy" TEXT,
    "confirmationNumber" TEXT,
    "createdBy" TEXT,
    "formData" JSONB,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollTaxFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EFTPSTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "filingId" TEXT,
    "enrollmentId" TEXT,
    "ein" TEXT,
    "taxType" "TaxPaymentType" NOT NULL,
    "taxYear" INTEGER,
    "taxPeriod" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "settlementDate" TIMESTAMP(3),
    "scheduledDate" TIMESTAMP(3),
    "scheduledBy" TEXT,
    "status" "EFTPSStatus" NOT NULL DEFAULT 'DRAFT',
    "eftpsConfirmation" TEXT,
    "eftpsTraceId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "bankAccountId" TEXT,
    "bankRoutingNumber" TEXT,
    "bankAccountLast4" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EFTPSTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EFTPSEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ein" TEXT NOT NULL,
    "enrollmentStatus" TEXT NOT NULL DEFAULT 'NOT_ENROLLED',
    "enrolledAt" TIMESTAMP(3),
    "businessName" TEXT,
    "businessAddress" TEXT,
    "businessCity" TEXT,
    "businessState" TEXT,
    "businessZip" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "eftpsPin" TEXT,
    "eftpsTaxpayerKey" TEXT,
    "bankAccountId" TEXT,
    "emailConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "emailReminders" BOOLEAN NOT NULL DEFAULT true,
    "reminderDays" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EFTPSEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileDeposit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "depositDate" TIMESTAMP(3),
    "referenceNumber" TEXT,
    "checkAmount" DECIMAL(19,4) NOT NULL,
    "checkNumber" TEXT,
    "checkDate" TIMESTAMP(3),
    "payerName" TEXT,
    "payerAddress" TEXT,
    "payerBankName" TEXT,
    "routingNumber" TEXT,
    "accountNumber" TEXT,
    "micr" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "frontImagePath" TEXT,
    "backImagePath" TEXT,
    "frontImageHash" TEXT,
    "status" "MobileDepositStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "processedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "fundedAt" TIMESTAMP(3),
    "fundedAmount" DECIMAL(19,4),
    "bankReferenceId" TEXT,
    "bankConfirmation" TEXT,
    "holdAmount" DECIMAL(19,4),
    "holdReleaseDate" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "returnCode" TEXT,
    "journalId" TEXT,
    "deviceId" TEXT,
    "appVersion" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "ipAddress" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBankAccount" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'CHECKING',
    "bankName" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "nameOnAccount" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verificationMethod" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT,
    "prenoteStatus" TEXT,
    "prenoteSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "type" TEXT,
    "amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "periodEndDate" TIMESTAMP(3) NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "parameters" JSONB,
    "filters" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "requestedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "fileUrl" TEXT,
    "fileSize" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "entityType" TEXT,
    "entityId" TEXT,
    "actionUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BillDocuments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_InvoiceDocuments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_EstimateDocuments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_PODocuments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_ReceiptDocuments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_ExpenseDocuments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_ExpenseAudit" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_TimesheetAudit" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "TaxCorpusSource_sourceType_idx" ON "TaxCorpusSource"("sourceType");

-- CreateIndex
CREATE INDEX "TaxCorpusSource_status_idx" ON "TaxCorpusSource"("status");

-- CreateIndex
CREATE INDEX "TaxDocument_documentType_idx" ON "TaxDocument"("documentType");

-- CreateIndex
CREATE INDEX "TaxDocument_status_idx" ON "TaxDocument"("status");

-- CreateIndex
CREATE INDEX "TaxDocument_identifier_idx" ON "TaxDocument"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_sourceId_identifier_version_key" ON "TaxDocument"("sourceId", "identifier", "version");

-- CreateIndex
CREATE INDEX "TaxSection_sectionNumber_idx" ON "TaxSection"("sectionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TaxSection_documentId_sectionNumber_key" ON "TaxSection"("documentId", "sectionNumber");

-- CreateIndex
CREATE INDEX "TaxRule_ruleType_idx" ON "TaxRule"("ruleType");

-- CreateIndex
CREATE INDEX "TaxRule_sectionId_idx" ON "TaxRule"("sectionId");

-- CreateIndex
CREATE INDEX "TaxDefinition_term_idx" ON "TaxDefinition"("term");

-- CreateIndex
CREATE INDEX "TaxCrossReference_targetIdentifier_idx" ON "TaxCrossReference"("targetIdentifier");

-- CreateIndex
CREATE INDEX "TaxExtraction_extractionType_idx" ON "TaxExtraction"("extractionType");

-- CreateIndex
CREATE INDEX "TaxExtraction_documentId_idx" ON "TaxExtraction"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxGraphNode_identifier_key" ON "TaxGraphNode"("identifier");

-- CreateIndex
CREATE INDEX "TaxGraphNode_nodeType_idx" ON "TaxGraphNode"("nodeType");

-- CreateIndex
CREATE INDEX "TaxGraphEdge_edgeType_idx" ON "TaxGraphEdge"("edgeType");

-- CreateIndex
CREATE UNIQUE INDEX "TaxGraphEdge_sourceId_targetId_edgeType_key" ON "TaxGraphEdge"("sourceId", "targetId", "edgeType");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_externalId_key" ON "Organization"("externalId");

-- CreateIndex
CREATE INDEX "Organization_entityType_idx" ON "Organization"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUser_organizationId_userId_key" ON "OrganizationUser"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Account_accountType_idx" ON "Account"("accountType");

-- CreateIndex
CREATE UNIQUE INDEX "Account_organizationId_accountNumber_key" ON "Account"("organizationId", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AccountTaxMapping_accountId_key" ON "AccountTaxMapping"("accountId");

-- CreateIndex
CREATE INDEX "FiscalPeriod_fiscalYear_idx" ON "FiscalPeriod"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPeriod_organizationId_fiscalYear_periodType_periodNum_key" ON "FiscalPeriod"("organizationId", "fiscalYear", "periodType", "periodNumber");

-- CreateIndex
CREATE INDEX "Journal_journalDate_idx" ON "Journal"("journalDate");

-- CreateIndex
CREATE INDEX "Journal_status_idx" ON "Journal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_organizationId_journalNumber_key" ON "Journal"("organizationId", "journalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_journalId_lineNumber_key" ON "JournalLine"("journalId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLineTaxClassification_journalLineId_key" ON "JournalLineTaxClassification"("journalLineId");

-- CreateIndex
CREATE INDEX "JournalLineTaxClassification_ircSection_idx" ON "JournalLineTaxClassification"("ircSection");

-- CreateIndex
CREATE INDEX "JournalLineTaxClassification_taxTreatment_idx" ON "JournalLineTaxClassification"("taxTreatment");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_externalId_key" ON "Customer"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_organizationId_externalId_key" ON "Vendor"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "Bill_status_idx" ON "Bill"("status");

-- CreateIndex
CREATE INDEX "Bill_dueDate_idx" ON "Bill"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_organizationId_vendorId_billNumber_key" ON "Bill"("organizationId", "vendorId", "billNumber");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDate_idx" ON "BankTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_status_idx" ON "BankTransaction"("status");

-- CreateIndex
CREATE INDEX "TaxReturn_taxYear_idx" ON "TaxReturn"("taxYear");

-- CreateIndex
CREATE INDEX "TaxReturn_status_idx" ON "TaxReturn"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReturn_organizationId_taxYear_returnType_key" ON "TaxReturn"("organizationId", "taxYear", "returnType");

-- CreateIndex
CREATE INDEX "TaxPosition_organizationId_taxYear_idx" ON "TaxPosition"("organizationId", "taxYear");

-- CreateIndex
CREATE INDEX "Estimate_customerId_idx" ON "Estimate"("customerId");

-- CreateIndex
CREATE INDEX "Estimate_status_idx" ON "Estimate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_organizationId_estimateNumber_key" ON "Estimate"("organizationId", "estimateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateLineItem_estimateId_lineNumber_key" ON "EstimateLineItem"("estimateId", "lineNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_poNumber_key" ON "PurchaseOrder"("organizationId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "POLineItem_poId_lineNumber_key" ON "POLineItem"("poId", "lineNumber");

-- CreateIndex
CREATE INDEX "GoodsReceipt_poId_idx" ON "GoodsReceipt"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_receiptNumber_key" ON "GoodsReceipt"("organizationId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GRLineItem_receiptId_lineNumber_key" ON "GRLineItem"("receiptId", "lineNumber");

-- CreateIndex
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

-- CreateIndex
CREATE INDEX "Expense_status_idx" ON "Expense"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_expenseNumber_key" ON "Expense"("organizationId", "expenseNumber");

-- CreateIndex
CREATE INDEX "InventoryItem_quantity_idx" ON "InventoryItem"("quantity");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_organizationId_sku_key" ON "InventoryItem"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "InventoryLedger_itemId_idx" ON "InventoryLedger"("itemId");

-- CreateIndex
CREATE INDEX "InventoryLedger_transactionType_idx" ON "InventoryLedger"("transactionType");

-- CreateIndex
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");

-- CreateIndex
CREATE INDEX "ExchangeRate_effectiveDate_idx" ON "ExchangeRate"("effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_fromCurrency_toCurrency_effectiveDate_key" ON "ExchangeRate"("fromCurrency", "toCurrency", "effectiveDate");

-- CreateIndex
CREATE INDEX "Budget_status_idx" ON "Budget"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_organizationId_budgetName_fiscalYear_key" ON "Budget"("organizationId", "budgetName", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLineItem_budgetId_accountId_key" ON "BudgetLineItem"("budgetId", "accountId");

-- CreateIndex
CREATE INDEX "Employee_email_idx" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_employeeId_key" ON "Employee"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "Timesheet_status_idx" ON "Timesheet"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_employeeId_weekStartDate_key" ON "Timesheet"("employeeId", "weekStartDate");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_relatedEntityType_relatedEntityId_idx" ON "Document"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_organizationId_idx" ON "AuditTrailEntry"("organizationId");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_entityType_entityId_idx" ON "AuditTrailEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_actionType_idx" ON "AuditTrailEntry"("actionType");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_userId_idx" ON "AuditTrailEntry"("userId");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_createdAt_idx" ON "AuditTrailEntry"("createdAt");

-- CreateIndex
CREATE INDEX "BulkImport_status_idx" ON "BulkImport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BulkImportRow_importId_rowNumber_key" ON "BulkImportRow"("importId", "rowNumber");

-- CreateIndex
CREATE INDEX "ClassificationFeedback_status_idx" ON "ClassificationFeedback"("status");

-- CreateIndex
CREATE INDEX "ClassificationFeedback_feedbackType_idx" ON "ClassificationFeedback"("feedbackType");

-- CreateIndex
CREATE INDEX "MigrationJob_status_idx" ON "MigrationJob"("status");

-- CreateIndex
CREATE INDEX "PaymentGateway_provider_idx" ON "PaymentGateway"("provider");

-- CreateIndex
CREATE INDEX "PaymentGateway_status_idx" ON "PaymentGateway"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGateway_organizationId_provider_name_key" ON "PaymentGateway"("organizationId", "provider", "name");

-- CreateIndex
CREATE INDEX "PaymentMethod_customerId_idx" ON "PaymentMethod"("customerId");

-- CreateIndex
CREATE INDEX "PaymentMethod_type_idx" ON "PaymentMethod"("type");

-- CreateIndex
CREATE INDEX "PaymentTransaction_organizationId_idx" ON "PaymentTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_customerId_idx" ON "PaymentTransaction"("customerId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_invoiceId_idx" ON "PaymentTransaction"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_providerTransactionId_idx" ON "PaymentTransaction"("providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentRefund_transactionId_idx" ON "PaymentRefund"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_organizationId_key" ON "PayrollSettings"("organizationId");

-- CreateIndex
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");

-- CreateIndex
CREATE INDEX "PayrollRun_payDate_idx" ON "PayrollRun"("payDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_organizationId_runNumber_key" ON "PayrollRun"("organizationId", "runNumber");

-- CreateIndex
CREATE INDEX "Paycheck_employeeId_idx" ON "Paycheck"("employeeId");

-- CreateIndex
CREATE INDEX "Paycheck_status_idx" ON "Paycheck"("status");

-- CreateIndex
CREATE INDEX "PaycheckDeduction_paycheckId_idx" ON "PaycheckDeduction"("paycheckId");

-- CreateIndex
CREATE INDEX "PaycheckDeduction_type_idx" ON "PaycheckDeduction"("type");

-- CreateIndex
CREATE INDEX "PaycheckTax_paycheckId_idx" ON "PaycheckTax"("paycheckId");

-- CreateIndex
CREATE INDEX "PaycheckTax_taxType_idx" ON "PaycheckTax"("taxType");

-- CreateIndex
CREATE INDEX "EmployeeDeductionSetup_employeeId_idx" ON "EmployeeDeductionSetup"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDeductionSetup_type_idx" ON "EmployeeDeductionSetup"("type");

-- CreateIndex
CREATE INDEX "W2Form_taxYear_idx" ON "W2Form"("taxYear");

-- CreateIndex
CREATE INDEX "W2Form_status_idx" ON "W2Form"("status");

-- CreateIndex
CREATE UNIQUE INDEX "W2Form_organizationId_employeeId_taxYear_key" ON "W2Form"("organizationId", "employeeId", "taxYear");

-- CreateIndex
CREATE INDEX "SalesTaxRate_organizationId_idx" ON "SalesTaxRate"("organizationId");

-- CreateIndex
CREATE INDEX "SalesTaxRate_jurisdictionType_idx" ON "SalesTaxRate"("jurisdictionType");

-- CreateIndex
CREATE INDEX "SalesTaxRate_effectiveDate_idx" ON "SalesTaxRate"("effectiveDate");

-- CreateIndex
CREATE INDEX "TaxAgency_jurisdictionType_idx" ON "TaxAgency"("jurisdictionType");

-- CreateIndex
CREATE UNIQUE INDEX "TaxAgency_organizationId_name_key" ON "TaxAgency"("organizationId", "name");

-- CreateIndex
CREATE INDEX "SalesTaxLiability_organizationId_idx" ON "SalesTaxLiability"("organizationId");

-- CreateIndex
CREATE INDEX "SalesTaxLiability_agencyId_idx" ON "SalesTaxLiability"("agencyId");

-- CreateIndex
CREATE INDEX "SalesTaxLiability_status_idx" ON "SalesTaxLiability"("status");

-- CreateIndex
CREATE INDEX "SalesTaxLiability_dueDate_idx" ON "SalesTaxLiability"("dueDate");

-- CreateIndex
CREATE INDEX "SalesTaxFiling_liabilityId_idx" ON "SalesTaxFiling"("liabilityId");

-- CreateIndex
CREATE INDEX "SalesTaxFiling_filedDate_idx" ON "SalesTaxFiling"("filedDate");

-- CreateIndex
CREATE INDEX "ProductTaxability_organizationId_idx" ON "ProductTaxability"("organizationId");

-- CreateIndex
CREATE INDEX "ProductTaxability_taxRateId_idx" ON "ProductTaxability"("taxRateId");

-- CreateIndex
CREATE INDEX "FixedAsset_assetType_idx" ON "FixedAsset"("assetType");

-- CreateIndex
CREATE INDEX "FixedAsset_status_idx" ON "FixedAsset"("status");

-- CreateIndex
CREATE INDEX "FixedAsset_acquisitionDate_idx" ON "FixedAsset"("acquisitionDate");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_organizationId_assetNumber_key" ON "FixedAsset"("organizationId", "assetNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetAccount_assetId_key" ON "FixedAssetAccount"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationSchedule_assetId_key" ON "DepreciationSchedule"("assetId");

-- CreateIndex
CREATE INDEX "DepreciationSchedule_method_idx" ON "DepreciationSchedule"("method");

-- CreateIndex
CREATE INDEX "DepreciationEntry_periodDate_idx" ON "DepreciationEntry"("periodDate");

-- CreateIndex
CREATE INDEX "DepreciationEntry_isPosted_idx" ON "DepreciationEntry"("isPosted");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationEntry_assetId_periodDate_key" ON "DepreciationEntry"("assetId", "periodDate");

-- CreateIndex
CREATE UNIQUE INDEX "AssetDisposal_assetId_key" ON "AssetDisposal"("assetId");

-- CreateIndex
CREATE INDEX "AssetDisposal_disposalDate_idx" ON "AssetDisposal"("disposalDate");

-- CreateIndex
CREATE INDEX "AssetDisposal_disposalMethod_idx" ON "AssetDisposal"("disposalMethod");

-- CreateIndex
CREATE INDEX "BankFeedConnection_provider_idx" ON "BankFeedConnection"("provider");

-- CreateIndex
CREATE INDEX "BankFeedConnection_status_idx" ON "BankFeedConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BankFeedConnection_bankAccountId_provider_key" ON "BankFeedConnection"("bankAccountId", "provider");

-- CreateIndex
CREATE INDEX "BankFeedSync_connectionId_idx" ON "BankFeedSync"("connectionId");

-- CreateIndex
CREATE INDEX "BankFeedSync_status_idx" ON "BankFeedSync"("status");

-- CreateIndex
CREATE INDEX "BankFeedSync_startedAt_idx" ON "BankFeedSync"("startedAt");

-- CreateIndex
CREATE INDEX "BankFeedRule_organizationId_idx" ON "BankFeedRule"("organizationId");

-- CreateIndex
CREATE INDEX "BankFeedRule_isActive_idx" ON "BankFeedRule"("isActive");

-- CreateIndex
CREATE INDEX "BankFeedRule_priority_idx" ON "BankFeedRule"("priority");

-- CreateIndex
CREATE INDEX "Form1099_taxYear_idx" ON "Form1099"("taxYear");

-- CreateIndex
CREATE INDEX "Form1099_status_idx" ON "Form1099"("status");

-- CreateIndex
CREATE INDEX "Form1099_formType_idx" ON "Form1099"("formType");

-- CreateIndex
CREATE UNIQUE INDEX "Form1099_organizationId_vendorId_taxYear_formType_key" ON "Form1099"("organizationId", "vendorId", "taxYear", "formType");

-- CreateIndex
CREATE UNIQUE INDEX "Form1099Line_form1099Id_boxNumber_key" ON "Form1099Line"("form1099Id", "boxNumber");

-- CreateIndex
CREATE INDEX "Form1099Filing_form1099Id_idx" ON "Form1099Filing"("form1099Id");

-- CreateIndex
CREATE INDEX "Form1099Filing_filingType_idx" ON "Form1099Filing"("filingType");

-- CreateIndex
CREATE INDEX "CreditMemo_customerId_idx" ON "CreditMemo"("customerId");

-- CreateIndex
CREATE INDEX "CreditMemo_status_idx" ON "CreditMemo"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CreditMemo_organizationId_creditNumber_key" ON "CreditMemo"("organizationId", "creditNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CreditMemoLine_creditMemoId_lineNumber_key" ON "CreditMemoLine"("creditMemoId", "lineNumber");

-- CreateIndex
CREATE INDEX "CreditMemoApplication_invoiceId_idx" ON "CreditMemoApplication"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditMemoApplication_creditMemoId_invoiceId_key" ON "CreditMemoApplication"("creditMemoId", "invoiceId");

-- CreateIndex
CREATE INDEX "VendorCredit_vendorId_idx" ON "VendorCredit"("vendorId");

-- CreateIndex
CREATE INDEX "VendorCredit_status_idx" ON "VendorCredit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCredit_organizationId_creditNumber_key" ON "VendorCredit"("organizationId", "creditNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCreditLine_vendorCreditId_lineNumber_key" ON "VendorCreditLine"("vendorCreditId", "lineNumber");

-- CreateIndex
CREATE INDEX "VendorCreditApplication_billId_idx" ON "VendorCreditApplication"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCreditApplication_vendorCreditId_billId_key" ON "VendorCreditApplication"("vendorCreditId", "billId");

-- CreateIndex
CREATE INDEX "RecurringTemplate_type_idx" ON "RecurringTemplate"("type");

-- CreateIndex
CREATE INDEX "RecurringTemplate_status_idx" ON "RecurringTemplate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringTemplate_organizationId_name_key" ON "RecurringTemplate"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSchedule_templateId_key" ON "RecurringSchedule"("templateId");

-- CreateIndex
CREATE INDEX "RecurringSchedule_nextRunDate_idx" ON "RecurringSchedule"("nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringTransaction_templateId_idx" ON "RecurringTransaction"("templateId");

-- CreateIndex
CREATE INDEX "RecurringTransaction_scheduledDate_idx" ON "RecurringTransaction"("scheduledDate");

-- CreateIndex
CREATE INDEX "RecurringTransaction_status_idx" ON "RecurringTransaction"("status");

-- CreateIndex
CREATE INDEX "Class_organizationId_idx" ON "Class"("organizationId");

-- CreateIndex
CREATE INDEX "Class_isActive_idx" ON "Class"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Class_organizationId_name_parentId_key" ON "Class"("organizationId", "name", "parentId");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE INDEX "Location_isActive_idx" ON "Location"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Location_organizationId_name_parentId_key" ON "Location"("organizationId", "name", "parentId");

-- CreateIndex
CREATE INDEX "Project_customerId_idx" ON "Project"("customerId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_projectNumber_key" ON "Project"("organizationId", "projectNumber");

-- CreateIndex
CREATE INDEX "ProjectBudgetLine_projectId_idx" ON "ProjectBudgetLine"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTimeEntry_projectId_idx" ON "ProjectTimeEntry"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTimeEntry_employeeId_idx" ON "ProjectTimeEntry"("employeeId");

-- CreateIndex
CREATE INDEX "ProjectTimeEntry_date_idx" ON "ProjectTimeEntry"("date");

-- CreateIndex
CREATE INDEX "ProjectTimeEntry_isBillable_idx" ON "ProjectTimeEntry"("isBillable");

-- CreateIndex
CREATE INDEX "ProjectExpense_projectId_idx" ON "ProjectExpense"("projectId");

-- CreateIndex
CREATE INDEX "ProjectExpense_date_idx" ON "ProjectExpense"("date");

-- CreateIndex
CREATE INDEX "ProjectExpense_isBillable_idx" ON "ProjectExpense"("isBillable");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressInvoice_invoiceId_key" ON "ProgressInvoice"("invoiceId");

-- CreateIndex
CREATE INDEX "ProgressInvoice_estimateId_idx" ON "ProgressInvoice"("estimateId");

-- CreateIndex
CREATE INDEX "ProgressMilestone_status_idx" ON "ProgressMilestone"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressMilestone_estimateId_sequenceNumber_key" ON "ProgressMilestone"("estimateId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "CustomerStatement_customerId_idx" ON "CustomerStatement"("customerId");

-- CreateIndex
CREATE INDEX "CustomerStatement_statementDate_idx" ON "CustomerStatement"("statementDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerStatement_organizationId_statementNumber_key" ON "CustomerStatement"("organizationId", "statementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerStatementLine_statementId_lineNumber_key" ON "CustomerStatementLine"("statementId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalAccess_customerId_key" ON "CustomerPortalAccess"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPortalAccess_customerId_idx" ON "CustomerPortalAccess"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalAccess_organizationId_email_key" ON "CustomerPortalAccess"("organizationId", "email");

-- CreateIndex
CREATE INDEX "PortalInvoiceView_invoiceId_idx" ON "PortalInvoiceView"("invoiceId");

-- CreateIndex
CREATE INDEX "PortalInvoiceView_viewedAt_idx" ON "PortalInvoiceView"("viewedAt");

-- CreateIndex
CREATE INDEX "EmailTemplate_type_idx" ON "EmailTemplate"("type");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_organizationId_type_name_key" ON "EmailTemplate"("organizationId", "type", "name");

-- CreateIndex
CREATE INDEX "EmailLog_organizationId_idx" ON "EmailLog"("organizationId");

-- CreateIndex
CREATE INDEX "EmailLog_toEmail_idx" ON "EmailLog"("toEmail");

-- CreateIndex
CREATE INDEX "EmailLog_entityType_entityId_idx" ON "EmailLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- CreateIndex
CREATE INDEX "EmailLog_sentAt_idx" ON "EmailLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckTemplate_organizationId_name_key" ON "CheckTemplate"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CheckPrint_checkDate_idx" ON "CheckPrint"("checkDate");

-- CreateIndex
CREATE INDEX "CheckPrint_status_idx" ON "CheckPrint"("status");

-- CreateIndex
CREATE INDEX "CheckPrint_payeeId_idx" ON "CheckPrint"("payeeId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckPrint_organizationId_bankAccountId_checkNumber_key" ON "CheckPrint"("organizationId", "bankAccountId", "checkNumber");

-- CreateIndex
CREATE INDEX "CheckBatch_status_idx" ON "CheckBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CheckBatch_organizationId_batchNumber_key" ON "CheckBatch"("organizationId", "batchNumber");

-- CreateIndex
CREATE INDEX "InventoryBundle_bundleType_idx" ON "InventoryBundle"("bundleType");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBundle_organizationId_sku_key" ON "InventoryBundle"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "InventoryBundleItem_inventoryItemId_idx" ON "InventoryBundleItem"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBundleItem_bundleId_inventoryItemId_key" ON "InventoryBundleItem"("bundleId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "AssemblyBuild_status_idx" ON "AssemblyBuild"("status");

-- CreateIndex
CREATE INDEX "AssemblyBuild_buildDate_idx" ON "AssemblyBuild"("buildDate");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyBuild_organizationId_buildNumber_key" ON "AssemblyBuild"("organizationId", "buildNumber");

-- CreateIndex
CREATE INDEX "AssemblyBuildItem_inventoryItemId_idx" ON "AssemblyBuildItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "EmployeeBankAccount_employeeId_idx" ON "EmployeeBankAccount"("employeeId");

-- CreateIndex
CREATE INDEX "ACHBatch_status_idx" ON "ACHBatch"("status");

-- CreateIndex
CREATE INDEX "ACHBatch_effectiveDate_idx" ON "ACHBatch"("effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "ACHBatch_organizationId_batchNumber_key" ON "ACHBatch"("organizationId", "batchNumber");

-- CreateIndex
CREATE INDEX "ACHTransaction_status_idx" ON "ACHTransaction"("status");

-- CreateIndex
CREATE INDEX "ACHTransaction_receiverType_receiverId_idx" ON "ACHTransaction"("receiverType", "receiverId");

-- CreateIndex
CREATE INDEX "ACHTransaction_traceNumber_idx" ON "ACHTransaction"("traceNumber");

-- CreateIndex
CREATE INDEX "PayrollTaxFiling_status_idx" ON "PayrollTaxFiling"("status");

-- CreateIndex
CREATE INDEX "PayrollTaxFiling_dueDate_idx" ON "PayrollTaxFiling"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollTaxFiling_organizationId_filingType_taxYear_taxPerio_key" ON "PayrollTaxFiling"("organizationId", "filingType", "taxYear", "taxPeriod");

-- CreateIndex
CREATE INDEX "EFTPSTransaction_status_idx" ON "EFTPSTransaction"("status");

-- CreateIndex
CREATE INDEX "EFTPSTransaction_settlementDate_idx" ON "EFTPSTransaction"("settlementDate");

-- CreateIndex
CREATE INDEX "EFTPSTransaction_ein_taxYear_idx" ON "EFTPSTransaction"("ein", "taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "EFTPSEnrollment_organizationId_key" ON "EFTPSEnrollment"("organizationId");

-- CreateIndex
CREATE INDEX "MobileDeposit_bankAccountId_idx" ON "MobileDeposit"("bankAccountId");

-- CreateIndex
CREATE INDEX "MobileDeposit_status_idx" ON "MobileDeposit"("status");

-- CreateIndex
CREATE INDEX "MobileDeposit_depositDate_idx" ON "MobileDeposit"("depositDate");

-- CreateIndex
CREATE INDEX "MobileDeposit_frontImageHash_idx" ON "MobileDeposit"("frontImageHash");

-- CreateIndex
CREATE INDEX "VendorBankAccount_vendorId_idx" ON "VendorBankAccount"("vendorId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "IncomeStatement_organizationId_idx" ON "IncomeStatement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "ReportExport_organizationId_idx" ON "ReportExport"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_idx" ON "Notification"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "_BillDocuments_AB_unique" ON "_BillDocuments"("A", "B");

-- CreateIndex
CREATE INDEX "_BillDocuments_B_index" ON "_BillDocuments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_InvoiceDocuments_AB_unique" ON "_InvoiceDocuments"("A", "B");

-- CreateIndex
CREATE INDEX "_InvoiceDocuments_B_index" ON "_InvoiceDocuments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_EstimateDocuments_AB_unique" ON "_EstimateDocuments"("A", "B");

-- CreateIndex
CREATE INDEX "_EstimateDocuments_B_index" ON "_EstimateDocuments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_PODocuments_AB_unique" ON "_PODocuments"("A", "B");

-- CreateIndex
CREATE INDEX "_PODocuments_B_index" ON "_PODocuments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ReceiptDocuments_AB_unique" ON "_ReceiptDocuments"("A", "B");

-- CreateIndex
CREATE INDEX "_ReceiptDocuments_B_index" ON "_ReceiptDocuments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ExpenseDocuments_AB_unique" ON "_ExpenseDocuments"("A", "B");

-- CreateIndex
CREATE INDEX "_ExpenseDocuments_B_index" ON "_ExpenseDocuments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ExpenseAudit_AB_unique" ON "_ExpenseAudit"("A", "B");

-- CreateIndex
CREATE INDEX "_ExpenseAudit_B_index" ON "_ExpenseAudit"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_TimesheetAudit_AB_unique" ON "_TimesheetAudit"("A", "B");

-- CreateIndex
CREATE INDEX "_TimesheetAudit_B_index" ON "_TimesheetAudit"("B");

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TaxCorpusSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxSection" ADD CONSTRAINT "TaxSection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TaxDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxSection" ADD CONSTRAINT "TaxSection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaxSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TaxSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "TaxExtraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDefinition" ADD CONSTRAINT "TaxDefinition_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TaxSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxException" ADD CONSTRAINT "TaxException_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxException" ADD CONSTRAINT "TaxException_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TaxSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxLimitation" ADD CONSTRAINT "TaxLimitation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxLimitation" ADD CONSTRAINT "TaxLimitation_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TaxSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCrossReference" ADD CONSTRAINT "TaxCrossReference_sourceSectionId_fkey" FOREIGN KEY ("sourceSectionId") REFERENCES "TaxSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCrossReference" ADD CONSTRAINT "TaxCrossReference_targetSectionId_fkey" FOREIGN KEY ("targetSectionId") REFERENCES "TaxSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxExtraction" ADD CONSTRAINT "TaxExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TaxDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxExtraction" ADD CONSTRAINT "TaxExtraction_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TaxSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxGraphEdge" ADD CONSTRAINT "TaxGraphEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TaxGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxGraphEdge" ADD CONSTRAINT "TaxGraphEdge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "TaxGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTaxMapping" ADD CONSTRAINT "AccountTaxMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalPeriod" ADD CONSTRAINT "FiscalPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FiscalPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionTaxClassification" ADD CONSTRAINT "TransactionTaxClassification_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLineTaxClassification" ADD CONSTRAINT "JournalLineTaxClassification_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLineTaxClassification" ADD CONSTRAINT "JournalLineTaxClassification_transactionClassificationId_fkey" FOREIGN KEY ("transactionClassificationId") REFERENCES "TransactionTaxClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCitation" ADD CONSTRAINT "TaxCitation_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "JournalLineTaxClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CustomerPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineItem" ADD CONSTRAINT "BillLineItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineItem" ADD CONSTRAINT "BillLineItem_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineItem" ADD CONSTRAINT "BillLineItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "VendorPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedJournalId_fkey" FOREIGN KEY ("matchedJournalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReturn" ADD CONSTRAINT "TaxReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxForm" ADD CONSTRAINT "TaxForm_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxSchedule" ADD CONSTRAINT "TaxSchedule_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimatedPayment" ADD CONSTRAINT "EstimatedPayment_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPosition" ADD CONSTRAINT "TaxPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POLineItem" ADD CONSTRAINT "POLineItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRLineItem" ADD CONSTRAINT "GRLineItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLineItem" ADD CONSTRAINT "BudgetLineItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLineItem" ADD CONSTRAINT "BudgetLineItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTrailEntry" ADD CONSTRAINT "AuditTrailEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImport" ADD CONSTRAINT "BulkImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImportRow" ADD CONSTRAINT "BulkImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BulkImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "PaymentGateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "PayrollSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paycheck" ADD CONSTRAINT "Paycheck_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paycheck" ADD CONSTRAINT "Paycheck_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaycheckDeduction" ADD CONSTRAINT "PaycheckDeduction_paycheckId_fkey" FOREIGN KEY ("paycheckId") REFERENCES "Paycheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaycheckTax" ADD CONSTRAINT "PaycheckTax_paycheckId_fkey" FOREIGN KEY ("paycheckId") REFERENCES "Paycheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeductionSetup" ADD CONSTRAINT "EmployeeDeductionSetup_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "W2Form" ADD CONSTRAINT "W2Form_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxRate" ADD CONSTRAINT "SalesTaxRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAgency" ADD CONSTRAINT "TaxAgency_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxLiability" ADD CONSTRAINT "SalesTaxLiability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxLiability" ADD CONSTRAINT "SalesTaxLiability_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "TaxAgency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxLiability" ADD CONSTRAINT "SalesTaxLiability_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "SalesTaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxFiling" ADD CONSTRAINT "SalesTaxFiling_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "SalesTaxLiability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxFiling" ADD CONSTRAINT "SalesTaxFiling_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "TaxAgency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTaxability" ADD CONSTRAINT "ProductTaxability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTaxability" ADD CONSTRAINT "ProductTaxability_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "SalesTaxRate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAssetAccount" ADD CONSTRAINT "FixedAssetAccount_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationSchedule" ADD CONSTRAINT "DepreciationSchedule_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationEntry" ADD CONSTRAINT "DepreciationEntry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDisposal" ADD CONSTRAINT "AssetDisposal_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedConnection" ADD CONSTRAINT "BankFeedConnection_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedSync" ADD CONSTRAINT "BankFeedSync_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankFeedConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedRule" ADD CONSTRAINT "BankFeedRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form1099" ADD CONSTRAINT "Form1099_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form1099" ADD CONSTRAINT "Form1099_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form1099Line" ADD CONSTRAINT "Form1099Line_form1099Id_fkey" FOREIGN KEY ("form1099Id") REFERENCES "Form1099"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form1099Filing" ADD CONSTRAINT "Form1099Filing_form1099Id_fkey" FOREIGN KEY ("form1099Id") REFERENCES "Form1099"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemo" ADD CONSTRAINT "CreditMemo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemo" ADD CONSTRAINT "CreditMemo_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemoLine" ADD CONSTRAINT "CreditMemoLine_creditMemoId_fkey" FOREIGN KEY ("creditMemoId") REFERENCES "CreditMemo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemoApplication" ADD CONSTRAINT "CreditMemoApplication_creditMemoId_fkey" FOREIGN KEY ("creditMemoId") REFERENCES "CreditMemo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemoApplication" ADD CONSTRAINT "CreditMemoApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCredit" ADD CONSTRAINT "VendorCredit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCredit" ADD CONSTRAINT "VendorCredit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCreditLine" ADD CONSTRAINT "VendorCreditLine_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCreditApplication" ADD CONSTRAINT "VendorCreditApplication_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCreditApplication" ADD CONSTRAINT "VendorCreditApplication_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTemplate" ADD CONSTRAINT "RecurringTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpense" ADD CONSTRAINT "ProjectExpense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpense" ADD CONSTRAINT "ProjectExpense_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressInvoice" ADD CONSTRAINT "ProgressInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressInvoice" ADD CONSTRAINT "ProgressInvoice_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressMilestone" ADD CONSTRAINT "ProgressMilestone_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStatement" ADD CONSTRAINT "CustomerStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStatement" ADD CONSTRAINT "CustomerStatement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStatementLine" ADD CONSTRAINT "CustomerStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CustomerStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPortalAccess" ADD CONSTRAINT "CustomerPortalAccess_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalInvoiceView" ADD CONSTRAINT "PortalInvoiceView_portalAccessId_fkey" FOREIGN KEY ("portalAccessId") REFERENCES "CustomerPortalAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalInvoiceView" ADD CONSTRAINT "PortalInvoiceView_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckTemplate" ADD CONSTRAINT "CheckTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckTemplate" ADD CONSTRAINT "CheckTemplate_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckPrint" ADD CONSTRAINT "CheckPrint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckPrint" ADD CONSTRAINT "CheckPrint_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CheckTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckPrint" ADD CONSTRAINT "CheckPrint_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CheckBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckBatch" ADD CONSTRAINT "CheckBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckBatch" ADD CONSTRAINT "CheckBatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CheckTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBundle" ADD CONSTRAINT "InventoryBundle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBundleItem" ADD CONSTRAINT "InventoryBundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "InventoryBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBundleItem" ADD CONSTRAINT "InventoryBundleItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBuild" ADD CONSTRAINT "AssemblyBuild_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "InventoryBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBuildItem" ADD CONSTRAINT "AssemblyBuildItem_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "AssemblyBuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBuildItem" ADD CONSTRAINT "AssemblyBuildItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBankAccount" ADD CONSTRAINT "EmployeeBankAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ACHBatch" ADD CONSTRAINT "ACHBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ACHBatch" ADD CONSTRAINT "ACHBatch_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ACHTransaction" ADD CONSTRAINT "ACHTransaction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ACHBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ACHTransaction" ADD CONSTRAINT "ACHTransaction_employeeBankAccountId_fkey" FOREIGN KEY ("employeeBankAccountId") REFERENCES "EmployeeBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollTaxFiling" ADD CONSTRAINT "PayrollTaxFiling_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollTaxFiling" ADD CONSTRAINT "PayrollTaxFiling_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EFTPSTransaction" ADD CONSTRAINT "EFTPSTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EFTPSTransaction" ADD CONSTRAINT "EFTPSTransaction_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "PayrollTaxFiling"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EFTPSTransaction" ADD CONSTRAINT "EFTPSTransaction_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "EFTPSEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EFTPSEnrollment" ADD CONSTRAINT "EFTPSEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EFTPSEnrollment" ADD CONSTRAINT "EFTPSEnrollment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeposit" ADD CONSTRAINT "MobileDeposit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeposit" ADD CONSTRAINT "MobileDeposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBankAccount" ADD CONSTRAINT "VendorBankAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BillDocuments" ADD CONSTRAINT "_BillDocuments_A_fkey" FOREIGN KEY ("A") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BillDocuments" ADD CONSTRAINT "_BillDocuments_B_fkey" FOREIGN KEY ("B") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InvoiceDocuments" ADD CONSTRAINT "_InvoiceDocuments_A_fkey" FOREIGN KEY ("A") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InvoiceDocuments" ADD CONSTRAINT "_InvoiceDocuments_B_fkey" FOREIGN KEY ("B") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EstimateDocuments" ADD CONSTRAINT "_EstimateDocuments_A_fkey" FOREIGN KEY ("A") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EstimateDocuments" ADD CONSTRAINT "_EstimateDocuments_B_fkey" FOREIGN KEY ("B") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PODocuments" ADD CONSTRAINT "_PODocuments_A_fkey" FOREIGN KEY ("A") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PODocuments" ADD CONSTRAINT "_PODocuments_B_fkey" FOREIGN KEY ("B") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReceiptDocuments" ADD CONSTRAINT "_ReceiptDocuments_A_fkey" FOREIGN KEY ("A") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReceiptDocuments" ADD CONSTRAINT "_ReceiptDocuments_B_fkey" FOREIGN KEY ("B") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExpenseDocuments" ADD CONSTRAINT "_ExpenseDocuments_A_fkey" FOREIGN KEY ("A") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExpenseDocuments" ADD CONSTRAINT "_ExpenseDocuments_B_fkey" FOREIGN KEY ("B") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExpenseAudit" ADD CONSTRAINT "_ExpenseAudit_A_fkey" FOREIGN KEY ("A") REFERENCES "AuditTrailEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExpenseAudit" ADD CONSTRAINT "_ExpenseAudit_B_fkey" FOREIGN KEY ("B") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TimesheetAudit" ADD CONSTRAINT "_TimesheetAudit_A_fkey" FOREIGN KEY ("A") REFERENCES "AuditTrailEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TimesheetAudit" ADD CONSTRAINT "_TimesheetAudit_B_fkey" FOREIGN KEY ("B") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
