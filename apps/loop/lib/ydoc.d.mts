import type * as Y from "yjs";

export type Kind = { id: string; name: string; rich: boolean; hint: string };
export const KINDS: Kind[];
export const KIND_IDS: string[];
export function kindInfo(id: string): Kind | null;
export const PROGRESS_STATUSES: string[];
export const STATUS_LABEL: Record<string, string>;
export function newItem(kind: string, fields?: Record<string, unknown>): Y.Map<unknown>;
export function randomId(): string;
export function seed(doc: Y.Doc, kind: string): void;
export function seededState(kind: string, items?: Record<string, unknown>[]): Uint8Array;
export function richText(doc: Y.Doc): { text: string; embeds: string[] };
export function itemsOf(doc: Y.Doc): Record<string, any>[];
export function docText(doc: Y.Doc, kind: string): { text: string; embeds: string[] };
export function storedText(state: Uint8Array | Buffer | null | undefined, kind: string): { text: string; embeds: string[] };
