import type { Sql } from 'postgres';

export type CollectorOutcome = {
  status: 'pass' | 'fail' | 'error' | 'skipped';
  message: string;
  observed: Record<string, unknown>;
  content_hash?: string;
};

export type Collector = {
  kind: string;
  version: string;
  title: string;
  description: string;
  defaultSeverity: string;
  requiresHostAccess?: boolean;
  selfReferential?: boolean;
  suggestedControls?: string[];
  validateConfig(config: unknown): { ok: true } | { ok: false; reason: string };
  run(config: unknown, ctx: { tenantId: string; sql: Sql; env?: Record<string, string | undefined> }): Promise<CollectorOutcome>;
};

export const COLLECTORS: Map<string, Collector>;

export function runMonitors(
  sql: Sql,
  tenantId: string,
  opts?: { monitorKey?: string; dueOnly?: boolean },
): Promise<{
  results: { key: string; kind: string; status: string; message: string }[];
  pass: number;
  fail: number;
  error: number;
}>;
