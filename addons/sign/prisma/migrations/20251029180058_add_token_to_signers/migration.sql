/*
  Warnings:

  - A unique constraint covering the columns `[token]` on the table `document_signers` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_UPDATED';

-- AlterTable
ALTER TABLE "document_signers" ADD COLUMN     "token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "document_signers_token_key" ON "document_signers"("token");
