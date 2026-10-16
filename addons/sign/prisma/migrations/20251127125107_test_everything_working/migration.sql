/*
  Warnings:

  - A unique constraint covering the columns `[stripeCustomerId]` on the table `enterprise_requests` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "document_fields" DROP CONSTRAINT "document_fields_assignedToId_fkey";

-- DropIndex
DROP INDEX "enterprise_accounts_domain_key";

-- AlterTable
ALTER TABLE "enterprise_accounts" ALTER COLUMN "domain" DROP NOT NULL;

-- AlterTable
ALTER TABLE "enterprise_requests" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_requests_stripeCustomerId_key" ON "enterprise_requests"("stripeCustomerId");
