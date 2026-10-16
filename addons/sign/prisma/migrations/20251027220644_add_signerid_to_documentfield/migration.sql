-- AlterTable
ALTER TABLE "document_fields" ADD COLUMN     "signerID" TEXT,
ALTER COLUMN "pageNumber" DROP NOT NULL;
