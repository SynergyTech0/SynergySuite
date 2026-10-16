/*
  Warnings:

  - You are about to drop the column `userId` on the `enterprise_requests` table. All the data in the column will be lost.
  - Added the required column `contactEmail` to the `enterprise_requests` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contactName` to the `enterprise_requests` table without a default value. This is not possible if the table is not empty.
  - Added the required column `submitter` to the `enterprise_requests` table without a default value. This is not possible if the table is not empty.
  - Added the required column `teamSize` to the `enterprise_requests` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "enterprise_requests" DROP CONSTRAINT "enterprise_requests_userId_fkey";

-- AlterTable
ALTER TABLE "enterprise_requests" DROP COLUMN "userId",
ADD COLUMN     "contactEmail" TEXT NOT NULL,
ADD COLUMN     "contactName" TEXT NOT NULL,
ADD COLUMN     "submitter" TEXT NOT NULL,
ADD COLUMN     "teamSize" TEXT NOT NULL,
ALTER COLUMN "message" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "enterprise_requests" ADD CONSTRAINT "enterprise_requests_submitter_fkey" FOREIGN KEY ("submitter") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
