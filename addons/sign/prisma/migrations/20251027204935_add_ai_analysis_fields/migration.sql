-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "aiAnalysis" JSONB,
ADD COLUMN     "aiAnalyzedAt" TIMESTAMP(3),
ADD COLUMN     "aiKeywords" TEXT[],
ADD COLUMN     "aiSummary" TEXT;
