"use client";
import { CheckSquare, HelpCircle, List, ListChecks, ListOrdered, Pilcrow, Table, Vote, Activity } from "lucide-react";

const ICONS: Record<string, typeof List> = {
  tasks: ListChecks,
  checklist: CheckSquare,
  table: Table,
  voting: Vote,
  progress: Activity,
  qa: HelpCircle,
  bullets: List,
  numbered: ListOrdered,
  note: Pilcrow,
};

export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = ICONS[kind] ?? Pilcrow;
  return <Icon size={size} className="kindicon" aria-hidden />;
}
