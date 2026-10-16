// Sensitivity labels across Docs, Sheets and Slides. The organization's labels come from the
// Admin center (GET /api/labels, see lib/policy.ts); a document keeps the id of its label in
// documents.label_id, so the list, search and every editor can show it. Word, Excel and
// PowerPoint files carry a label as MSIP_Label_<id>_* custom properties (docProps/custom.xml):
// exports write them and imports read them back. Labels only mark a file; nothing is encrypted.
//
// Browser code imports this file, so it takes only the label helpers from @synergy/compliance
// (its index also holds server-only code).
import { DEFAULT_LABELS, matchLabel, msipProperties, type LabelSettings, type SensitivityLabel } from "@synergy/compliance/dist/labels";
import { labelOf } from "./sensitivity";

export type { LabelSettings, SensitivityLabel };
/** The suite's four labels, offered when the Admin center can't be reached. */
export { DEFAULT_LABELS };

/** A label as a file names it: the id and name Office writes. */
export type FileLabel = { id: string; name: string };

const LABEL_PROP = /^MSIP_Label_[0-9a-fA-F-]{36}_\w+$/;

export const isLabelProperty = (name: string) => LABEL_PROP.test(name);

/** The enabled label recorded in a file's custom properties, if any. */
export function fileLabelOf(custom: Record<string, string> | undefined | null): FileLabel | null {
  if (!custom) return null;
  // Docs reads boolean properties as Y/N (for DOCPROPERTY fields); MSIP writes Enabled as text.
  const props = Object.entries(custom).map(([name, value]) => ({ name, type: "lpwstr", value: /_Enabled$/.test(name) && value === "Y" ? "true" : value }));
  const l = labelOf(props);
  return l ? { id: l.id.toLowerCase(), name: l.name } : null;
}

/** The custom properties with any label replaced by this one (none: the label removed). */
export function withFileLabel(custom: Record<string, string> | undefined | null, label: FileLabel | null, setDate = new Date()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom || {})) if (!isLabelProperty(k)) out[k] = v;
  for (const [k, v] of msipProperties(label, setDate)) out[k] = v;
  return out;
}

/** The organization's label a file arrived with: by id, or by name for another tenant's ids. */
export function knownLabel(settings: LabelSettings, file: FileLabel | null | undefined): SensitivityLabel | null {
  return file ? matchLabel(settings, file.id, file.name) : null;
}

/** GET /api/labels: the organization's labels, least sensitive first, and the one new documents get. */
export type LabelList = { labels: SensitivityLabel[]; defaultLabelId: string | null };
