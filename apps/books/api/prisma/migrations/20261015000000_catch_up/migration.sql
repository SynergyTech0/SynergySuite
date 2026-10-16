-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "stripeHostedUrl" TEXT,
ADD COLUMN     "stripeInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "CardTransactionPosting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeTxnId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "journalId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT,
    "cardLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardTransactionPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardTransactionPosting_organizationId_idx" ON "CardTransactionPosting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CardTransactionPosting_organizationId_stripeTxnId_key" ON "CardTransactionPosting"("organizationId", "stripeTxnId");

