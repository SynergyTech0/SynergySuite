"use client";
/**
 * Turns a file someone picks into draw.io XML, in the browser. Visio drawings (.vsdx) go through
 * draw.io's own Visio importer: /drawio/vsdxImporter.html loads it into a hidden frame on this
 * origin and exposes doImport(buffer, done, error). Old binary Visio files (.vsd) need a
 * conversion server draw.io runs for its own site, so they are refused with a way round.
 */

export const ACCEPT = ".vsdx,.vsdm,.vssx,.vsd,.drawio,.dio,.xml,.svg,.png";

type ImporterWindow = Window & {
  doImport?: (buf: ArrayBuffer | null, done: (xml: string) => void, error: (e: unknown) => void, file?: File) => void;
  Editor?: { extractGraphModelFromPng?: (dataUrl: string) => string | null };
};

let frame: Promise<ImporterWindow> | null = null;

function importer(): Promise<ImporterWindow> {
  frame ??= new Promise<ImporterWindow>((resolve, reject) => {
    const f = document.createElement("iframe");
    f.src = "/drawio/vsdxImporter.html";
    f.title = "Visio importer";
    f.style.display = "none";
    f.onload = () => {
      const w = f.contentWindow as ImporterWindow | null;
      if (w?.doImport) resolve(w);
      else reject(new Error("The Visio importer didn't load"));
    };
    f.onerror = () => reject(new Error("The Visio importer didn't load"));
    document.body.appendChild(f);
  }).catch((e) => {
    frame = null;
    throw e;
  });
  return frame;
}

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}

/** The draw.io diagram an SVG export carries in its content attribute. */
function fromSvg(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const content = doc.documentElement?.getAttribute("content");
  return content && content.trim().startsWith("<mxfile") ? content : null;
}

export async function fileToXml(file: File): Promise<string> {
  const e = ext(file.name);
  if (e === "vsd" || e === "vss" || e === "vdx") {
    throw new Error("Only Visio's current format opens here. Save it as a .vsdx drawing in Visio first.");
  }
  if (e === "vsdx" || e === "vssx" || e === "vsdm") {
    const w = await importer();
    // The file goes in as itself: the importer reads its name to tell .vsdx from stencils (.vssx).
    return new Promise<string>((resolve, reject) => {
      w.doImport!(
        null,
        (xml) => (xml ? resolve(xml) : reject(new Error("That Visio file has nothing in it to open"))),
        () => reject(new Error("That Visio file couldn't be read")),
        file,
      );
    });
  }
  if (e === "png") {
    const w = await importer();
    const xml = w.Editor?.extractGraphModelFromPng?.(await readDataUrl(file));
    if (!xml) throw new Error("That picture has no diagram in it. Only PNGs exported from draw.io carry one.");
    return xml;
  }
  const text = await file.text();
  const t = text.replace(/^﻿/, "").trim();
  if (e === "svg" || t.startsWith("<svg") || (t.startsWith("<?xml") && t.includes("<svg"))) {
    const xml = fromSvg(t);
    if (!xml) throw new Error("That SVG has no diagram in it. Only SVGs exported from draw.io carry one.");
    return xml;
  }
  const body = t.replace(/^<\?xml[^>]*\?>\s*/, "");
  if (body.startsWith("<mxfile") || body.startsWith("<mxGraphModel")) return body;
  throw new Error("That isn't a file Diagrams can open. Try a .vsdx, .drawio or .xml diagram.");
}
