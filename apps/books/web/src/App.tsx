import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Layout } from './components/Layout';
import { useAuth } from './stores/authStore';
import { Dashboard } from './pages/Dashboard';
import { ChartOfAccounts } from './pages/ChartOfAccounts';
import { JournalEntries } from './pages/JournalEntries';
import { Customers } from './pages/Customers';
import { Invoices } from './pages/Invoices';
import { NewInvoice } from './pages/NewInvoice';
import { Vendors } from './pages/Vendors';
import { Bills } from './pages/Bills';
import { NewBill } from './pages/NewBill';
import { Projects } from './pages/Projects';
import { Payroll } from './pages/Payroll';
import { BankAccounts } from './pages/BankAccounts';
import { BankTransactions } from './pages/BankTransactions';
import { BankFeedReview } from './pages/BankFeedReview';
import { SpendCards } from './pages/SpendCards';
import { Reports } from './pages/Reports';
import { TaxClassification } from './pages/TaxClassification';
import { TaxAi } from './pages/TaxAi';
import { Settings } from './pages/Settings';
import { PrintChecks } from './pages/PrintChecks';
import { InventoryBundles } from './pages/InventoryBundles';
import { DirectDeposit } from './pages/DirectDeposit';
import { TaxFiling } from './pages/TaxFiling';
import { MobileDeposit } from './pages/MobileDeposit';
import { Budgets } from './pages/Budgets';
import { Consolidation } from './pages/Consolidation';

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const load = useAuth((s) => s.load);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) load().catch((e: Error) => setError(e.message));
  }, [user, load]);

  if (user) return <>{children}</>;
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      {error ? (
        <span>Books could not load your account: {error}</span>
      ) : (
        <>
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Signing in…
        </>
      )}
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="accounts" element={<ChartOfAccounts />} />
        <Route path="journals" element={<JournalEntries />} />
        <Route path="customers" element={<Customers />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<NewInvoice />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="bills" element={<Bills />} />
        <Route path="bills/new" element={<NewBill />} />
        <Route path="banking" element={<BankAccounts />} />
        <Route path="banking/review" element={<BankFeedReview />} />
        <Route path="cards" element={<SpendCards />} />
        <Route path="banking/transactions" element={<BankTransactions />} />
        <Route path="projects" element={<Projects />} />
        <Route path="reports" element={<Reports />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="consolidation" element={<Consolidation />} />
        <Route path="tax-classification" element={<TaxClassification />} />
        <Route path="tax-ai" element={<TaxAi />} />
        <Route path="settings" element={<Settings />} />
        <Route path="banking/print-checks" element={<PrintChecks />} />
        <Route path="banking/mobile-deposit" element={<MobileDeposit />} />
        <Route path="banking/direct-deposit" element={<DirectDeposit />} />
        <Route path="inventory/bundles" element={<InventoryBundles />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="payroll/tax-filing" element={<TaxFiling />} />
      </Route>
    </Routes>
  );
}

export default App;
