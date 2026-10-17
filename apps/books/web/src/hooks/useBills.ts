import { useOrgList } from './useOrgList';

export type Bill = {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  status: string; // DRAFT | PENDING_APPROVAL | APPROVED | PARTIAL | PAID | OVERDUE | VOID
  totalAmount: string | number;
  amountPaid: string | number;
  amountDue: string | number;
  paidAt?: string | null;
  vendorId: string;
  vendor?: { id: string; name: string } | null;
};

/** Every bill for the org (newest first), for the Bills page totals and per-vendor counts. */
export function useBills() {
  return useOrgList<Bill>('bills', { take: 1000 });
}
