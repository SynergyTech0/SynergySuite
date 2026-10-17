import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from './utils';
import { TopBar } from '../components/TopBar';
import { Dashboard } from '../pages/Dashboard';
import { Customers } from '../pages/Customers';
import { useAuth } from '../stores/authStore';
import { initials } from '../lib/format';

const user = {
  id: 'u1',
  email: 'shane@example.com',
  firstName: 'Shane',
  lastName: 'Owner',
  role: 'ADMIN',
  organizationId: 'org1',
};

const emptyList = { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 };
const zeroTotals = { totalRevenue: 0, totalExpenses: 0, netIncome: 0 };

/** Answers each API path the way a freshly wiped company would. */
function fakeApi(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.replace(/^\/api/, '').split('?')[0];
    const match = Object.keys(overrides).find((k) => path.endsWith(k));
    let body: unknown;
    if (match) body = overrides[match];
    else if (path.endsWith('/reports/income-statement')) body = { totals: zeroTotals, sections: {} };
    else if (path.endsWith('/invoices/aging'))
      body = {
        summary: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 },
        detail: { current: [], days1to30: [], days31to60: [], days61to90: [], over90: [] },
      };
    else if (path.endsWith('/tax-classification/stats')) body = { byCategory: [], accuracy: null };
    else if (path === '/companies') body = [];
    else body = emptyList;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

beforeEach(() => {
  useAuth.setState({ user, suiteDomain: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initials', () => {
  it('uses the first and last name', () => {
    expect(initials('Shane Owner')).toBe('SO');
    expect(initials('Mary Ann de Vries')).toBe('MV');
    expect(initials('acme')).toBe('A');
    expect(initials('  ')).toBe('');
  });
});

describe('TopBar', () => {
  it('shows the signed-in user, not a sample person', async () => {
    vi.stubGlobal('fetch', fakeApi());
    renderWithProviders(<TopBar onMenuClick={() => {}} />);
    expect(screen.getByText('Shane Owner')).toBeInTheDocument();
    expect(screen.getByText('SO')).toBeInTheDocument();
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
  });
});

describe('Dashboard', () => {
  it('shows zeros and empty states for a company with no activity', async () => {
    vi.stubGlobal('fetch', fakeApi());
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText('$0.00')).toHaveLength(4));
    expect(await screen.findByText('No revenue or expenses yet')).toBeInTheDocument();
    expect(await screen.findByText('Nothing classified yet')).toBeInTheDocument();
    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument();
    expect(screen.queryByText(/328,500/)).not.toBeInTheDocument();
    expect(screen.queryByText(/98\.5%/)).not.toBeInTheDocument();
  });

  it('shows the YTD figures from the income statement', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({ '/reports/income-statement': { totals: { totalRevenue: 1200, totalExpenses: 450, netIncome: 750 }, sections: {} } }),
    );
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('$1,200.00')).toBeInTheDocument();
    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText('$750.00')).toBeInTheDocument();
  });
});

describe('Customers', () => {
  it('lists the customers the API returns', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({
        '/customers': {
          ...emptyList,
          total: 1,
          items: [{ id: 'c1', name: 'Real Client Ltd', email: 'ap@realclient.test', phone: null, balance: '250.0000' }],
        },
      }),
    );
    renderWithProviders(<Customers />);
    expect(await screen.findByText('Real Client Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    expect(screen.getAllByText('$250.00').length).toBeGreaterThan(0);
  });
});
