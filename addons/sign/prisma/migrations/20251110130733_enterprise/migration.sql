-- CreateEnum
CREATE TYPE "EnterpriseStatus" AS ENUM ('PENDING', 'DISCUSSION', 'APPROVED', 'REJECTED', 'ACTIVATED');

-- CreateTable
CREATE TABLE "enterprise_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "EnterpriseStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_audit_log" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "enterprise_audit_log_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "enterprise_requests" ADD CONSTRAINT "enterprise_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_audit_log" ADD CONSTRAINT "enterprise_audit_log_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "enterprise_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_audit_log" ADD CONSTRAINT "enterprise_audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
