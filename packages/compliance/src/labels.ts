/**
 * Sensitivity labels: one list for the whole suite, kept in the Admin center and handed to every
 * app in the policy feed. An app stores the label's id on the content (a file, a message, a
 * document), shows its name and color, and applies what the label's protection asks for. Office
 * files carry the label the way Microsoft Purview records it (MSIP_Label_<id>_* custom
 * properties), so the default labels keep the ids Synergy Sheets has always written.
 *
 * A label only marks content; encryption that a Purview label may add needs the organization's
 * Microsoft keys and is not applied.
 */

export interface LabelProtection {
  /** Refuse sharing outside the organization: public links, guests, outside recipients. */
  blockExternal: boolean;
  /** Text apps show on the content and add to outgoing copies, e.g. "CONFIDENTIAL". */
  marking?: string;
}

export interface SensitivityLabel {
  id: string;
  name: string;
  /** Hex color for the label chip. */
  color: string;
  /** Shown to people choosing a label. */
  description?: string;
  /** Higher is more sensitive; the list is sorted by it. */
  priority: number;
  protection: LabelProtection;
}

export interface LabelSettings {
  labels: SensitivityLabel[];
  /** Applied to new content when nobody picks one. */
  defaultLabelId?: string;
}

export const DEFAULT_LABELS: SensitivityLabel[] = [
  { id: "a8b6f1c2-0d3e-4f5a-9b6c-1d2e3f4a5b60", name: "Public", color: "#15803d", priority: 0, description: "Meant for anyone, inside or outside the company.", protection: { blockExternal: false } },
  { id: "b9c7a2d3-1e4f-4a6b-8c7d-2e3f4a5b6c71", name: "General", color: "#2563eb", priority: 1, description: "Everyday business content that isn't meant for the public.", protection: { blockExternal: false } },
  { id: "c0d8b3e4-2f5a-4b7c-9d8e-3f4a5b6c7d82", name: "Confidential", color: "#d97706", priority: 2, description: "Sensitive business content: customers, finances, plans.", protection: { blockExternal: false, marking: "CONFIDENTIAL" } },
  { id: "d1e9c4f5-3a6b-4c8d-8e9f-4a5b6c7d8e93", name: "Highly Confidential", color: "#b91c1c", priority: 3, description: "The most sensitive content. Can't be shared outside the company.", protection: { blockExternal: true, marking: "HIGHLY CONFIDENTIAL" } },
];

export const DEFAULT_LABEL_SETTINGS: LabelSettings = { labels: DEFAULT_LABELS };

export function labelById(settings: LabelSettings, id: string | null | undefined): SensitivityLabel | null {
  if (!id) return null;
  const key = id.replace(/[{}]/g, "").toLowerCase();
  return settings.labels.find((l) => l.id.toLowerCase() === key) ?? null;
}

/** The label a file arrived with, by id or else by name (another tenant's ids differ). */
export function matchLabel(settings: LabelSettings, id: string | null | undefined, name?: string | null): SensitivityLabel | null {
  return labelById(settings, id) ?? (name ? settings.labels.find((l) => l.name.toLowerCase() === name.trim().toLowerCase()) ?? null : null);
}

/** Whether content with this label may go outside the organization. Unknown labels are allowed. */
export function allowsExternal(settings: LabelSettings, id: string | null | undefined): boolean {
  return !labelById(settings, id)?.protection.blockExternal;
}

/** Whether moving from one label to another lowers sensitivity. */
export function isDowngrade(settings: LabelSettings, from: string | null | undefined, to: string | null | undefined): boolean {
  const a = labelById(settings, from);
  if (!a) return false;
  const b = labelById(settings, to);
  return !b || b.priority < a.priority;
}

/** The ordered list apps offer, most sensitive last. */
export function sortedLabels(settings: LabelSettings): SensitivityLabel[] {
  return [...settings.labels].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/**
 * The Office custom properties that record a label (docProps/custom.xml), so Word, Excel and
 * PowerPoint show it. Pass the existing properties to keep everything that isn't a label.
 */
export function msipProperties(label: Pick<SensitivityLabel, "id" | "name"> | null, setDate = new Date()): [string, string][] {
  if (!label) return [];
  const k = (s: string) => `MSIP_Label_${label.id}_${s}`;
  const zero = "00000000-0000-0000-0000-000000000000";
  return [
    [k("Enabled"), "true"],
    [k("SetDate"), setDate.toISOString().replace(/\.\d+Z$/, "Z")],
    [k("Method"), "Privileged"],
    [k("Name"), label.name],
    [k("SiteId"), zero],
    [k("ActionId"), zero],
    [k("ContentBits"), "0"],
  ];
}

/** The msip_labels header Outlook writes on labeled mail, so other clients see the label. */
export function msipHeader(label: Pick<SensitivityLabel, "id" | "name">): string {
  return msipProperties(label).map(([k, v]) => `${k}=${v}`).join("; ") + ";";
}

/** The label named in an msip_labels header, if any is enabled. */
export function parseMsipHeader(header: string | null | undefined): { id: string; name?: string } | null {
  if (!header) return null;
  const byId = new Map<string, Record<string, string>>();
  for (const part of header.split(";")) {
    const m = /^\s*MSIP_Label_([0-9a-fA-F-]{36})_(\w+)\s*=\s*(.*?)\s*$/.exec(part);
    if (m) (byId.get(m[1]) ?? byId.set(m[1], {}).get(m[1])!)[m[2]] = m[3];
  }
  for (const [id, p] of byId) if (/^true$/i.test(p.Enabled ?? "")) return { id: id.toLowerCase(), ...(p.Name ? { name: p.Name } : {}) };
  return null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Checks a label list from the Admin center; throws with a message an admin can act on. */
export function validateLabels(settings: LabelSettings): LabelSettings {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const l of settings.labels) {
    if (!/^[0-9a-f-]{36}$/i.test(l.id)) throw new Error(`Label "${l.name}" has a bad id`);
    if (!l.name.trim()) throw new Error("Every label needs a name");
    if (!HEX.test(l.color)) throw new Error(`Label "${l.name}" needs a color like #2563eb`);
    if (ids.has(l.id.toLowerCase())) throw new Error(`Two labels share the id ${l.id}`);
    if (names.has(l.name.trim().toLowerCase())) throw new Error(`Two labels are called "${l.name}"`);
    ids.add(l.id.toLowerCase());
    names.add(l.name.trim().toLowerCase());
  }
  if (settings.defaultLabelId && !ids.has(settings.defaultLabelId.toLowerCase())) throw new Error("The default label isn't in the list");
  return settings;
}
