import { useOrgList } from './useOrgList';

export type JournalEntry = {
  id: string;
  journalNumber: string;
  entryNumber?: string;
  journalDate: string;
  description?: string | null;
  reference?: string | null;
  status: string; // DRAFT | PENDING_APPROVAL | APPROVED | POSTED | REVERSED | VOIDED
  type?: string | null;
  sourceType?: string | null;
  isAdjusting?: boolean;
  isReversing?: boolean;
  totalDebit: number;
  totalCredit: number;
};

/** Journal entries, newest first. */
export function useJournals(params?: { search?: string; status?: string; take?: number }) {
  return useOrgList<JournalEntry>('journals', params);
}

/** GENERAL / ADJUSTING / REVERSING / CLOSING, from the entry's own type or flags. */
export function journalKind(j: JournalEntry): string {
  if (j.type) return j.type.toUpperCase();
  if (j.isReversing) return 'REVERSING';
  if (j.isAdjusting) return 'ADJUSTING';
  return 'GENERAL';
}
