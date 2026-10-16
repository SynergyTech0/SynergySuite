import type { Collector } from '../collect-runner.mjs';

export const COLLECTORS: Map<string, Collector>;

export function collectorCatalogue(): {
  kind: string;
  version: string;
  title: string;
  description: string;
  defaultSeverity: string;
  requiresHostAccess: boolean;
  selfReferential: boolean;
  suggestedControls: string[];
}[];

export function validateMonitorConfig(
  kind: string,
  config: unknown,
): { ok: true } | { ok: false; reason: string };
