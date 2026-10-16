-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "cloudProvider" "CloudProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "fileSize" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fileType" TEXT NOT NULL DEFAULT '';
