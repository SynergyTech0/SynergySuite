/*
  Warnings:

  - A unique constraint covering the columns `[administratorId]` on the table `enterprise_accounts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "enterprise_accounts" ADD COLUMN     "administratorId" TEXT,
ALTER COLUMN "userLimit" SET DEFAULT 25;

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_accounts_administratorId_key" ON "enterprise_accounts"("administratorId");

-- AddForeignKey
ALTER TABLE "enterprise_accounts" ADD CONSTRAINT "enterprise_accounts_administratorId_fkey" FOREIGN KEY ("administratorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
