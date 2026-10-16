// Animations in .odp as ODF writes them (SMIL in the anim: namespace, the way
// LibreOffice Impress stores its custom animations): a timing-root par per
// page holding the main click sequence and one interactive sequence per
// trigger, each effect a par with LibreOffice's preset class and id. Our own
// importer keeps reading the exact settings from syn:x; these nodes are for
// other applications, and reading them brings their animations in.
import { animKind, buildSteps, triggerSteps, type Anim, type AnimEffect, type AnimStep, type Slide } from "./model";
import type { XEl } from "./xml";

export const ANIM_NS = 'xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0" xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0"';

/** The xml:id a target gets on the page ("title", "body" or an element id). */
export const animId = (key: string) => `a-${key.replace(/[^\w.-]/g, "_")}`;

const DIR_SUB: Record<string, string> = { b: "bottom", t: "top", l: "left", r: "right" };
const sec = (ms: number) => `${Math.round(ms) / 1000}s`;

/** The SMIL nodes that play one effect on a target (visibility, transition filters, motion). */
function effectNodes(a: Anim, t: string): { cls: string; preset: string; sub?: string; nodes: string } {
  const k = animKind(a);
  const d = Math.max(1, a.dur);
  const T = `smil:targetElement="${t}"`;
  const show = `<anim:set smil:begin="0s" smil:dur="0.001s" smil:fill="hold" ${T} smil:attributeName="visibility" smil:to="visible"/>`;
  const hide = `<anim:set smil:begin="${sec(Math.max(0, d - 1))}" smil:dur="0.001s" smil:fill="hold" ${T} smil:attributeName="visibility" smil:to="hidden"/>`;
  const dir = DIR_SUB[a.dir || "b"] || "bottom";
  if (k === "path") {
    const p = (a.path || "M 0 0 L 0.25 0 E").replace(/\s*E\s*$/i, "");
    return { cls: "motion-path", preset: "ooo-motionpath-custom", nodes: `<anim:animateMotion smil:dur="${sec(d)}" smil:fill="hold" ${T} svg:path="${p}"/>` };
  }
  if (k === "emph") {
    if (a.effect === "spin") return { cls: "emphasis", preset: "ooo-emphasis-spin", nodes: `<anim:animateTransform smil:dur="${sec(d)}" smil:fill="hold" ${T} smil:by="360" svg:type="rotate"/>` };
    if (a.effect === "teeter") {
      const q = d / 5;
      const parts = [2, -4, 4, -4, 2].map((by, i) => `<anim:animateTransform smil:begin="${sec(i * q)}" smil:dur="${sec(q)}" smil:fill="hold" ${T} smil:by="${by}" svg:type="rotate"/>`);
      return { cls: "emphasis", preset: "ooo-emphasis-teeter", nodes: parts.join("") };
    }
    const by = a.effect === "grow" ? a.amount || 1.5 : 1.05;
    const back = a.effect === "pulse" ? ' smil:autoReverse="true"' : "";
    return { cls: "emphasis", preset: a.effect === "pulse" ? "ooo-emphasis-pulse" : "ooo-emphasis-grow-and-shrink", nodes: `<anim:animateTransform smil:dur="${sec(a.effect === "pulse" ? d / 2 : d)}" smil:fill="hold" ${T} smil:by="${by},${by}" svg:type="scale"${back}/>` };
  }
  const exit = k === "exit";
  const mode = exit ? ' smil:mode="out"' : "";
  const wrap = (body: string) => (exit ? body + hide : show + body);
  switch (a.effect) {
    case "appear":
      return exit ? { cls: "exit", preset: "ooo-exit-disappear", nodes: `<anim:set smil:begin="0s" smil:dur="0.001s" smil:fill="hold" ${T} smil:attributeName="visibility" smil:to="hidden"/>` } : { cls: "entrance", preset: "ooo-entrance-appear", nodes: show };
    case "fly": {
      const axis = dir === "left" || dir === "right" ? "x" : "y";
      const off = dir === "bottom" ? "1+height/2" : dir === "top" ? "0-height/2" : dir === "right" ? "1+width/2" : "0-width/2";
      const vals = exit ? `${axis};${off}` : `${off};${axis}`;
      const other = axis === "x" ? "y" : "x";
      return {
        cls: exit ? "exit" : "entrance",
        preset: exit ? "ooo-exit-fly-out" : "ooo-entrance-fly-in",
        sub: `${exit ? "to" : "from"}-${dir}`,
        nodes: wrap(`<anim:animate smil:dur="${sec(d)}" smil:fill="hold" ${T} smil:attributeName="${other}" smil:values="${other};${other}" smil:keyTimes="0;1"/><anim:animate smil:dur="${sec(d)}" smil:fill="hold" ${T} smil:attributeName="${axis}" smil:values="${vals}" smil:keyTimes="0;1"/>`),
      };
    }
    case "wipe": {
      const sub = dir === "left" || dir === "right" ? "leftToRight" : "topToBottom";
      const rev = dir === "bottom" || dir === "right" ? ' smil:direction="reverse"' : "";
      return { cls: exit ? "exit" : "entrance", preset: exit ? "ooo-exit-wipe" : "ooo-entrance-wipe", sub: `from-${dir}`, nodes: wrap(`<anim:transitionFilter smil:dur="${sec(d)}" ${T} smil:type="barWipe" smil:subtype="${sub}"${rev}${mode}/>`) };
    }
    case "zoom": {
      const v = (p: string) => (exit ? `${p};0` : `0;${p}`);
      return { cls: exit ? "exit" : "entrance", preset: exit ? "ooo-exit-zoom" : "ooo-entrance-zoom", sub: exit ? "out" : "in", nodes: wrap(`<anim:animate smil:dur="${sec(d)}" smil:fill="hold" ${T} smil:attributeName="width" smil:values="${v("width")}" smil:keyTimes="0;1"/><anim:animate smil:dur="${sec(d)}" smil:fill="hold" ${T} smil:attributeName="height" smil:values="${v("height")}" smil:keyTimes="0;1"/>`) };
    }
    case "split":
      return { cls: exit ? "exit" : "entrance", preset: exit ? "ooo-exit-split" : "ooo-entrance-split", sub: exit ? "horizontal-out" : "horizontal-in", nodes: wrap(`<anim:transitionFilter smil:dur="${sec(d)}" ${T} smil:type="barnDoorWipe" smil:subtype="horizontal"${exit ? "" : ' smil:direction="reverse"'}${mode}/>`) };
    default:
      return { cls: exit ? "exit" : "entrance", preset: exit ? "ooo-exit-fade-out" : "ooo-entrance-fade-in", nodes: wrap(`<anim:transitionFilter smil:dur="${sec(d)}" ${T} smil:type="fade" smil:subtype="crossfade"${mode}/>`) };
  }
}

/** One click sequence: a par per click, a par per "after previous" group inside it, a par per effect. */
function seqXml(steps: AnimStep[], ok: (key: string) => boolean): string {
  let out = "";
  for (const st of steps) {
    const groups: { at: number; items: string[] }[] = [];
    for (const it of st.items) {
      const key = it.key.replace(/#\d+$/, ""); // paragraph builds play on the whole text in other applications
      if (!ok(key) || /#[1-9]\d*$/.test(it.key)) continue;
      const start = it.at - it.anim.delay;
      let g = groups[groups.length - 1];
      if (!g || it.anim.start === "after" || Math.abs(g.at - start) > 0.5) groups.push((g = { at: start, items: [] }));
      const e = effectNodes(it.anim, animId(key));
      const node = it.anim.start === "with" ? "with-previous" : it.anim.start === "after" ? "after-previous" : "on-click";
      g.items.push(`<anim:par smil:begin="${sec(it.anim.delay)}" smil:fill="hold" presentation:node-type="${node}" presentation:preset-class="${e.cls}" presentation:preset-id="${e.preset}"${e.sub ? ` presentation:preset-sub-type="${e.sub}"` : ""}>${e.nodes}</anim:par>`);
    }
    if (!groups.length) continue;
    out += `<anim:par smil:begin="${st.auto ? "0s" : "indefinite"}" smil:fill="hold">${groups.map((g) => `<anim:par smil:begin="${sec(g.at)}" smil:fill="hold">${g.items.join("")}</anim:par>`).join("")}</anim:par>`;
  }
  return out;
}

/**
 * The page's animations as ODF SMIL, and the targets that need an xml:id.
 * `present` says which targets are on the page.
 */
export function smilXml(s: Slide, present: (key: string) => boolean): { xml: string; targets: Set<string> } {
  const targets = new Set<string>();
  const ok = (key: string) => {
    if (!present(key)) return false;
    targets.add(key);
    return true;
  };
  const main = seqXml(buildSteps(s), ok);
  let inter = "";
  for (const [trig, steps] of triggerSteps(s)) {
    if (!present(trig)) continue;
    const body = seqXml(steps, ok);
    if (!body) continue;
    targets.add(trig);
    inter += `<anim:seq smil:begin="${animId(trig)}.click" smil:end="${animId(trig)}.click" presentation:node-type="interactive-sequence">${body.replace(/smil:begin="indefinite"/g, 'smil:begin="0s"')}</anim:seq>`;
  }
  if (!main && !inter) return { xml: "", targets };
  return { xml: `<anim:par presentation:node-type="timing-root">${main ? `<anim:seq presentation:node-type="main-sequence">${main}</anim:seq>` : ""}${inter}</anim:par>`, targets };
}

/** Give the animated targets on a page their xml:id (frames named syn-el-<id>, syn-title, syn-body). */
export function addAnimIds(xml: string, targets: Set<string>): string {
  if (!targets.size) return xml;
  const names = new Map([...targets].map((k) => [k === "title" ? "syn-title" : k === "body" ? "syn-body" : `syn-el-${k}`, k]));
  const done = new Set<string>();
  return xml.replace(/<(draw:[\w-]+)((?:\s+[\w:-]+="[^"]*")*?)\s+draw:name="([^"]+)"/g, (m, tag: string, before: string, nm: string) => {
    const key = names.get(nm);
    if (!key || done.has(nm)) return m;
    done.add(nm);
    return `<${tag}${before} xml:id="${animId(key)}" draw:id="${animId(key)}" draw:name="${nm}"`;
  });
}

// ------------------------------------------------------------------ reading

const at = (el: XEl | undefined, q: string) => el?.attrs[q];
const secs = (v: string | undefined): number => {
  if (!v) return 0;
  const m = /^(-?[\d.]+)(ms|s|min|h)?$/.exec(v.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return Math.round((m[2] === "ms" ? n : m[2] === "min" ? n * 60000 : m[2] === "h" ? n * 3600000 : n * 1000));
};
const kidsOf = (el: XEl | undefined) => (el ? el.children.filter((c) => c.local !== "#text") : []);
/** Every element inside `el`. */
const allOf = (el: XEl, out: XEl[] = []): XEl[] => {
  for (const c of kidsOf(el)) {
    out.push(c);
    allOf(c, out);
  }
  return out;
};

function effectOf(par: XEl, keyOf: (id: string) => string | undefined, start: Anim["start"], order: number): { key: string; anim: Anim } | undefined {
  const all = allOf(par);
  const tgt = [par, ...all].map((n) => at(n, "smil:targetElement")).find(Boolean);
  const key = tgt ? keyOf(tgt) : undefined;
  if (!key) return undefined;
  const cls = at(par, "presentation:preset-class") || "";
  const id = at(par, "presentation:preset-id") || "";
  const sub = at(par, "presentation:preset-sub-type") || "";
  const dur = Math.max(0, ...all.map((n) => secs(at(n, "smil:dur")) + secs(at(n, "smil:begin"))));
  const kind: Anim["kind"] | undefined = cls === "exit" ? "exit" : cls === "emphasis" ? "emph" : cls === "motion-path" ? "path" : undefined;
  let effect: AnimEffect;
  if (kind === "path") effect = "path";
  else if (kind === "emph") effect = /spin/.test(id) ? "spin" : /teeter/.test(id) ? "teeter" : /grow|shrink/.test(id) ? "grow" : "pulse";
  else effect = /appear|disappear/.test(id) ? "appear" : /fly/.test(id) ? "fly" : /wipe/.test(id) ? "wipe" : /zoom/.test(id) ? "zoom" : /split/.test(id) ? "split" : "fade";
  const anim: Anim = { effect, start, dur: effect === "appear" ? 500 : Math.max(100, dur || 500), delay: secs(at(par, "smil:begin")), order };
  if (kind) anim.kind = kind;
  const d = /(?:from|to)-(bottom|top|left|right)/.exec(sub)?.[1];
  if (d && (effect === "fly" || effect === "wipe")) anim.dir = d[0] as Anim["dir"];
  if (kind === "path") {
    const p = all.map((n) => at(n, "svg:path")).find(Boolean);
    if (!p) return undefined;
    anim.path = `${p.trim()} E`;
  }
  if (effect === "grow") {
    const by = all.map((n) => at(n, "smil:by")).find((v) => v && v.includes(","));
    const f = by ? Number(by.split(",")[0]) : NaN;
    if (Number.isFinite(f) && f > 0 && f !== 1.5) anim.amount = f;
  }
  return { key, anim };
}

/** Effects in one sequence (click pars > group pars > effect pars), in order. */
function readSeq(seq: XEl, keyOf: (id: string) => string | undefined, order: { n: number }, trigger?: string): { key: string; anim: Anim }[] {
  const out: { key: string; anim: Anim }[] = [];
  for (const click of kidsOf(seq).filter((n) => n.local === "par")) {
    for (const group of kidsOf(click).filter((n) => n.local === "par")) {
      for (const eff of kidsOf(group).filter((n) => n.local === "par")) {
        const nt = at(eff, "presentation:node-type");
        const start: Anim["start"] = nt === "with-previous" ? "with" : nt === "after-previous" ? "after" : "click";
        const r = effectOf(eff, keyOf, start, order.n);
        if (!r) continue;
        order.n++;
        if (trigger) r.anim.trigger = trigger;
        out.push(r);
      }
    }
  }
  return out;
}

/**
 * A page's SMIL animations as our effects per target ("title", "body" or an
 * element id), from an ODF page (LibreOffice Impress and others).
 */
export function readSmil(page: XEl, keyOf: (id: string) => string | undefined): Map<string, Anim[]> {
  const out = new Map<string, Anim[]>();
  const root = kidsOf(page).find((n) => n.local === "par" && at(n, "presentation:node-type") === "timing-root");
  if (!root) return out;
  const order = { n: 1 };
  const add = (list: { key: string; anim: Anim }[]) => list.forEach(({ key, anim }) => out.set(key, [...(out.get(key) || []), anim]));
  for (const seq of kidsOf(root).filter((n) => n.local === "seq")) {
    const nt = at(seq, "presentation:node-type");
    if (nt === "main-sequence") add(readSeq(seq, keyOf, order));
    else if (nt === "interactive-sequence") {
      const trig = /^([^.]+)\.click$/.exec(at(seq, "smil:begin") || "")?.[1];
      const key = trig ? keyOf(trig) : undefined;
      if (key) add(readSeq(seq, keyOf, order, key));
    }
  }
  return out;
}

