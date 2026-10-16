/*
  Warnings:

  - You are about to drop the column `assignedTo` on the `document_fields` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "document_fields" DROP COLUMN "assignedTo",
ADD COLUMN     "assignedToId" TEXT;

-- AddForeignKey
ALTER TABLE "document_fields" ADD CONSTRAINT "document_fields_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "document_signers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
