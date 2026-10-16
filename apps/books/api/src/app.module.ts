import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './modules/auth/auth.module';
import { BankLinkingModule } from './modules/bank-linking/bank-linking.module';
import { TaxAiModule } from './modules/tax-ai/tax-ai.module';
import { AutomationModule } from './modules/automation/automation.module';
import { ClassLocationModule } from './modules/class-location/class-location.module';
import { CreditMemoModule } from './modules/credit-memo/credit-memo.module';
import { CustomerPortalModule } from './modules/customer-portal/customer-portal.module';
import { SvcModule } from './modules/svc/svc.module';
import { OpsLinkModule } from './modules/ops-link/ops-link.module';
import { EmailModule } from './modules/email/email.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RecurringModule } from './modules/recurring/recurring.module';
import { ReportExportsModule } from './modules/report-exports/report-exports.module';
import { TaxAdvisorModule } from './modules/tax-advisor/tax-advisor.module';
import { VendorCreditModule } from './modules/vendor-credit/vendor-credit.module';
import { Form1099Module } from './modules/form-1099/form-1099.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { AccountModule } from './modules/account/account.module';
import { JournalModule } from './modules/journal/journal.module';
import { FiscalPeriodModule } from './modules/fiscal-period/fiscal-period.module';
import { TaxClassificationModule } from './modules/tax-classification/tax-classification.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { CustomerModule } from './modules/customer/customer.module';
import { CardsModule } from './modules/cards/cards.module';
import { VendorModule } from './modules/vendor/vendor.module';
import { BankingModule } from './modules/banking/banking.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { EstimateModule } from './modules/estimate/estimate.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { TimesheetModule } from './modules/timesheet/timesheet.module';
import { AuditModule } from './modules/audit/audit.module';
import { DocumentModule } from './modules/document/document.module';
import { BulkImportModule } from './modules/import/bulk-import.module';
import { PurchaseOrderModule } from './modules/purchase-order/purchase-order.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { BudgetModule } from './modules/budget/budget.module';
import { SalesTaxModule } from './modules/sales-tax/sales-tax.module';
import { FixedAssetsModule } from './modules/fixed-assets/fixed-assets.module';
import { BankFeedsModule } from './modules/bank-feeds/bank-feeds.module';
import { CheckPrintingModule } from './modules/check-printing/check-printing.module';
import { InventoryBundlesModule } from './modules/inventory-bundles/inventory-bundles.module';
import { ACHProcessingModule } from './modules/ach-processing/ach-processing.module';
import { EFTPSFilingModule } from './modules/eftps-filing/eftps-filing.module';
import { MobileDepositModule } from './modules/mobile-deposit/mobile-deposit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    OrganizationModule,
    AccountModule,
    JournalModule,
    FiscalPeriodModule,
    TaxClassificationModule,
    ReportingModule,
    CustomerModule,
    CardsModule,
    VendorModule,
    BankingModule,
    EstimateModule,
    ExpenseModule,
    InventoryModule,
    TimesheetModule,
    AuditModule,
    DocumentModule,
    BulkImportModule,
    PurchaseOrderModule,
    CurrencyModule,
    BudgetModule,
    SalesTaxModule,
    FixedAssetsModule,
    BankFeedsModule,
    CheckPrintingModule,
    InventoryBundlesModule,
    ACHProcessingModule,
    EFTPSFilingModule,
    MobileDepositModule,
    AutomationModule,
    ClassLocationModule,
    CreditMemoModule,
    CustomerPortalModule,
    SvcModule,
    OpsLinkModule,
    EmailModule,
    PaymentsModule,
    PayrollModule,
    ProjectsModule,
    RecurringModule,
    ReportExportsModule,
    TaxAdvisorModule,
    VendorCreditModule,
    Form1099Module,
    BankLinkingModule,
    TaxAiModule,
  ],
})
export class AppModule {}
