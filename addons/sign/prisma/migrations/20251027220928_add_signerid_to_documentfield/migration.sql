/*
  Warnings:

  - You are about to drop the column `signerID` on the `document_fields` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "document_fields" DROP COLUMN "signerID",
ADD COLUMN     "signerId" TEXT;
