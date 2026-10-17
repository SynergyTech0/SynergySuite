// Office's side of the suite's compliance policy (see packages/compliance): the organization's
// sensitivity labels from the Admin center. Server only.
import { createPolicyClient, labelById, sortedLabels, type ProtectionClient } from "@synergy/compliance";
import type { LabelList } from "./labels";

export const APP = "office";

const g = globalThis as unknown as { __officePolicy?: ProtectionClient };

/** One policy client per process. */
export function policy(): ProtectionClient {
  return (g.__officePolicy ??= createPolicyClient({ app: APP }));
}

/** Swaps the policy client, for tests. */
export function setPolicy(p: ProtectionClient | undefined): void {
  g.__officePolicy = p;
}

/** The labels people choose from, least sensitive first, and the one new documents get. */
export async function labelList(): Promise<LabelList> {
  const settings = await policy().labels();
  return { labels: sortedLabels(settings), defaultLabelId: settings.defaultLabelId ?? null };
}

/** The label a new document starts with: the organization's default, if it has one. */
export async function newDocumentLabel(): Promise<string | null> {
  const settings = await policy().labels();
  return labelById(settings, settings.defaultLabelId)?.id ?? null;
}
