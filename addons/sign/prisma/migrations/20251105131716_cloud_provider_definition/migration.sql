-- CreateEnum
CREATE TYPE "CloudProvider" AS ENUM ('LOCAL', 'AWS', 'AZURE', 'GOOGLE');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "cloudProvider" "CloudProvider" NOT NULL DEFAULT 'LOCAL';
