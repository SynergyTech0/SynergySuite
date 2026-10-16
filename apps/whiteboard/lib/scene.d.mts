export declare const ELEMENTS: "elements";
export declare const FILES: "files";
export declare const MAX_FILE_CHARS: number;
export type SceneElement = { id: string; type: string; isDeleted?: boolean; text?: string; containerId?: string | null; x: number; y: number; [k: string]: unknown };
export declare function liveElements(values: Iterable<unknown>): SceneElement[];
export declare function sceneSummary(values: Iterable<unknown>): { text: string; count: number };
