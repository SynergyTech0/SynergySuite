import { useOrgList } from './useOrgList';

// Prisma serializes Decimal as string over JSON — money fields arrive as strings.
export type Customer = {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  balance?: string | number | null;
  isActive?: boolean | null;
};

export type Vendor = {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  balance?: string | number | null;
  is1099?: boolean;
  requires1099?: boolean;
  isActive?: boolean | null;
};

/** Customers, paged envelope; the API searches name, email and company. */
export function useCustomers(search?: string) {
  return useOrgList<Customer>('customers', { search, take: 500 });
}

/** Vendors, paged envelope; the API searches name, email and company. */
export function useVendors(search?: string) {
  return useOrgList<Vendor>('vendors', { search, take: 500 });
}
