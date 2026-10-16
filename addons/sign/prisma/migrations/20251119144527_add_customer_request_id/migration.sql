/*
  Warnings:

  - A unique constraint covering the columns `[customerRequestId]` on the table `enterprise_requests` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "enterprise_requests" ADD COLUMN     "customerRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_requests_customerRequestId_key" ON "enterprise_requests"("customerRequestId");
