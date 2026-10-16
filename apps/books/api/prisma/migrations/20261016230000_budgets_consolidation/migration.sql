-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "classId" TEXT,
ADD COLUMN     "forecastAsOf" TIMESTAMP(3),
ADD COLUMN     "forecastMethod" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "BudgetLineItem" ADD COLUMN     "forecastPeriods" DECIMAL(19,4)[],
ADD COLUMN     "periodAmounts" DECIMAL(19,4)[];

-- CreateTable
CREATE TABLE "ConsolidationGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportingCurrency" TEXT NOT NULL DEFAULT 'USD',
    "parentOrganizationId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsolidationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsolidationMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsolidationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntercompanyTransaction" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "fromOrganizationId" TEXT NOT NULL,
    "toOrganizationId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "fromAmount" DECIMAL(19,4) NOT NULL,
    "toAmount" DECIMAL(19,4) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "fromJournalId" TEXT,
    "toJournalId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntercompanyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsolidationMember_organizationId_idx" ON "ConsolidationMember"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsolidationMember_groupId_organizationId_key" ON "ConsolidationMember"("groupId", "organizationId");

-- CreateIndex
CREATE INDEX "IntercompanyTransaction_fromOrganizationId_idx" ON "IntercompanyTransaction"("fromOrganizationId");

-- CreateIndex
CREATE INDEX "IntercompanyTransaction_toOrganizationId_idx" ON "IntercompanyTransaction"("toOrganizationId");

-- AddForeignKey
ALTER TABLE "ConsolidationMember" ADD CONSTRAINT "ConsolidationMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ConsolidationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsolidationMember" ADD CONSTRAINT "ConsolidationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Everyone already in Books belongs to the company they work in.
INSERT INTO "OrganizationUser" ("id", "organizationId", "userId", "role", "permissions", "createdAt", "updatedAt")
SELECT 'ou_' || u."id", u."organizationId", u."id", u."role", ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
JOIN "Organization" o ON o."id" = u."organizationId"
ON CONFLICT ("organizationId", "userId") DO NOTHING;
