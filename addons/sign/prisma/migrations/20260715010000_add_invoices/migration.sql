CREATE TABLE "invoices" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "clientLegalName" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "monthlyCents" INTEGER NOT NULL,
  "setupCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" TEXT NOT NULL DEFAULT 'AWAITING_SIGNATURES',
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoices_documentId_key" ON "invoices"("documentId");
CREATE UNIQUE INDEX "invoices_token_key" ON "invoices"("token");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
