// Slide transitions and entrance animations <-> PresentationML.
// PptxGenJS cannot write either, so the exporter patches the generated slide
// XML with transitionXml()/timingXml(); the importer reads them back with
// readTransition()/readTiming().
import { child, descendants, kids, num, attr, type XEl } from "./xml";
import { animKind, buildSteps, triggerSteps, type Anim, type AnimEffect, type AnimKind, type AnimSound, type AnimStep, type Slide, type Transition, type TransType } from "./model";

// ------------------------------------------------------------- transitions

const SPD = (ms: number) => (ms <= 500 ? "fast" : ms <= 900 ? "med" : "slow");

export function transitionXml(t: Transition | undefined): string {
  if (!t) return "";
  const attrs = [`spd="${SPD(t.dur)}"`];
  if (t.advClick === false) attrs.push('advClick="0"');
  if (t.advAfter) attrs.push(`advTm="${Math.round(t.advAfter)}"`);
  const dir = t.dir || "l";
  if (t.type === "morph") {
    // PowerPoint 2019+ reads the morph choice; everything else falls back to a fade
    const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    const p14 = "http://schemas.microsoft.com/office/powerpoint/2010/main";
    const p159 = "http://schemas.microsoft.com/office/powerpoint/2015/09/main";
    return `<mc:AlternateContent xmlns:mc="${mc}"><mc:Choice xmlns:p159="${p159}" Requires="p159"><p:transition xmlns:p14="${p14}" ${attrs.join(" ")} p14:dur="${Math.round(t.dur)}"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition ${attrs.join(" ")}><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
  }
  let inner = "";
  switch (t.type) {
    case "fade": inner = "<p:fade/>"; break;
    case "push": inner = `<p:push dir="${dir}"/>`; break;
    case "wipe": inner = `<p:wipe dir="${dir}"/>`; break;
    case "cover": inner = `<p:cover dir="${dir}"/>`; break;
    case "split": inner = '<p:split orient="vert" dir="out"/>'; break;
    case "zoom": inner = '<p:zoom dir="in"/>'; break;
  }
  return `<p:transition ${attrs.join(" ")}>${inner}</p:transition>`;
}

const TRANS_OF: Record<string, TransType> = { fade: "fade", push: "push", wipe: "wipe", cover: "cover", pull: "cover", split: "split", zoom: "zoom", morph: "morph", cut: "none" };

/** Read <p:transition> (directly or inside mc:AlternateContent) from a <p:sld>. */
export function readTransition(sld: XEl): Transition | undefined {
  let tr = child(sld, "transition");
  if (!tr) {
    for (const ac of kids(sld, "AlternateContent")) {
      const choice = child(ac, "Choice"), fb = child(ac, "Fallback");
      const c = child(choice, "transition"), f = child(fb, "transition");
      // prefer the richer p14 transition when it is one we know, else the fallback
      tr = c && c.children.some((x) => TRANS_OF[x.local]) ? c : f || c;
      if (tr) break;
    }
  }
  if (!tr) return undefined;
  const eff = tr.children.find((x) => x.local !== "sndAc" && x.local !== "extLst");
  const type: TransType = eff ? TRANS_OF[eff.local] || "fade" : "none";
  const durAttr = Object.entries(tr.attrs).find(([k]) => k.endsWith(":dur"))?.[1];
  const spd = attr(tr, "spd");
  const dur = durAttr ? Number(durAttr) : spd === "fast" ? 500 : spd === "slow" ? 1000 : 750;
  const t: Transition = { type, dur };
  const d = attr(eff, "dir");
  if (d && ["l", "r", "u", "d"].includes(d)) t.dir = d as Transition["dir"];
  if (attr(tr, "advClick") === "0") t.advClick = false;
  const adv = num(tr, "advTm");
  if (adv !== undefined) t.advAfter = adv;
  if (type === "none" && t.advClick !== false && !t.advAfter) return undefined;
  return t;
}

// -------------------------------------------------------------- animations

const SUBTYPE: Record<string, number> = { t: 1, r: 2, b: 4, l: 8 };
const DIR_OF: Record<number, Anim["dir"]> = { 1: "t", 2: "r", 4: "b", 8: "l" };
const PRESET: Record<AnimEffect, number> = { appear: 1, fly: 2, fade: 10, split: 16, wipe: 22, zoom: 53, pulse: 26, spin: 8, grow: 6, teeter: 32, path: 0 };
const CLASS: Record<AnimKind, string> = { entr: "entr", exit: "exit", emph: "emph", path: "path" };

export type Target = { spid: number; para?: number; text: boolean };
/** Audio/video on the slide: start with the slide (`autoplay`) and/or repeat (`loop`). */
export type MediaTiming = { spid: number; audio: boolean; autoplay: boolean; loop: boolean };

/** An animation sound in the package: its relationship id and file name. */
export type SoundRef = { rid: string; name: string };

/**
 * Build <p:timing> for a slide. `target` resolves an animation key to a shape
 * id; `sound` the relationship of an effect's sound (embedded WAV). Effects
 * with a trigger go in an interactive sequence started by clicks on it.
 */
export function timingXml(s: Slide, target: (key: string) => Target | undefined, media: MediaTiming[] = [], sound?: (snd: AnimSound) => SoundRef | undefined): string {
  const steps = buildSteps(s);
  const trig = [...triggerSteps(s)].flatMap(([k, st]) => {
    const t = target(k);
    return t ? [{ spid: t.spid, steps: st }] : [];
  });
  if (!steps.length && !trig.length && !media.some((m) => m.autoplay || m.loop)) return "";
  let id = 2;
  const nid = () => ++id;
  const bld = new Map<string, string>(); // "spid|grpId" -> build attribute
  const grps = new Map<string, number>(); // one build group per effect and shape
  const grpOf = (spid: number, a: Anim) => {
    const k = `${spid}|${a.order}|${animKind(a)}`;
    if (!grps.has(k)) grps.set(k, [...grps.keys()].filter((x) => x.startsWith(`${spid}|`)).length);
    return grps.get(k)!;
  };
  const seqXml = (steps: AnimStep[], interactive: boolean): string[] => {
  const stepXml: string[] = [];
  for (const [si, st] of steps.entries()) {
    // group effects that start together (same start offset) into one inner par
    const groups = new Map<number, typeof st.items>();
    for (const it of st.items) {
      const g = it.at - it.anim.delay;
      groups.set(g, [...(groups.get(g) || []), it]);
    }
    const inner: string[] = [];
    let first = true;
    for (const [g, items] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const effs: string[] = [];
      for (const it of items) {
        const tg = target(it.key);
        if (!tg) continue;
        const a = it.anim;
        const nodeType = first && effs.length === 0 ? (a.start === "click" ? "clickEffect" : a.start === "with" ? "withEffect" : "afterEffect") : a.start === "after" ? "afterEffect" : "withEffect";
        const spTgt = `<p:tgtEl><p:spTgt spid="${tg.spid}">${tg.para !== undefined ? `<p:txEl><p:pRg st="${tg.para}" end="${tg.para}"/></p:txEl>` : ""}</p:spTgt></p:tgtEl>`;
        const kind = animKind(a);
        const dur = a.effect === "appear" ? 1 : a.dur;
        const vis = (val: "visible" | "hidden", at = 0) =>
          `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${at}"/></p:stCondLst></p:cTn>${spTgt}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
        const anim = (attrName: string, from: string, to: string) =>
          `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${nid()}" dur="${dur}" fill="hold"/>${spTgt}<p:attrNameLst><p:attrName>${attrName}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
        const filter = (f: string, dirn: "in" | "out") => `<p:animEffect transition="${dirn}" filter="${f}"><p:cBhvr><p:cTn id="${nid()}" dur="${dur}"/>${spTgt}</p:cBhvr></p:animEffect>`;
        const rot = (by: number, d: number, at = 0) => `<p:animRot by="${by}"><p:cBhvr><p:cTn id="${nid()}" dur="${d}" fill="hold">${at ? `<p:stCondLst><p:cond delay="${at}"/></p:stCondLst>` : ""}</p:cTn>${spTgt}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
        const scale = (pct: number, d: number, autoRev: boolean) => `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${d}"${autoRev ? ' autoRev="1"' : ""} fill="hold"/>${spTgt}</p:cBhvr><p:by x="${pct}" y="${pct}"/></p:animScale>`;
        const dir = a.dir || "b";
        let beh = "";
        let subtype = 0;
        if (kind === "entr" || kind === "exit") {
          const io = kind === "entr" ? "in" : "out";
          if (kind === "entr") beh = vis("visible");
          if (a.effect === "fade") beh += filter("fade", io);
          else if (a.effect === "wipe") beh += filter(`wipe(${{ t: "down", b: "up", l: "right", r: "left" }[dir]})`, io);
          else if (a.effect === "split") beh += filter(`barn(${io}Vertical)`, io);
          else if (a.effect === "zoom") beh += kind === "entr" ? anim("ppt_w", "0", "#ppt_w") + anim("ppt_h", "0", "#ppt_h") + filter("fade", io) : anim("ppt_w", "#ppt_w", "0") + anim("ppt_h", "#ppt_h", "0") + filter("fade", io);
          else if (a.effect === "fly") {
            const x = dir === "l" ? "0-#ppt_w/2" : dir === "r" ? "1+#ppt_w/2" : "#ppt_x";
            const y = dir === "t" ? "0-#ppt_h/2" : dir === "b" ? "1+#ppt_h/2" : "#ppt_y";
            beh += kind === "entr" ? anim("ppt_x", x, "#ppt_x") + anim("ppt_y", y, "#ppt_y") : anim("ppt_x", "#ppt_x", x) + anim("ppt_y", "#ppt_y", y);
          }
          if (kind === "exit") beh += vis("hidden", Math.max(0, dur - 1));
          subtype = a.effect === "fly" || a.effect === "wipe" ? SUBTYPE[dir] : a.effect === "split" ? (kind === "entr" ? 21 : 37) : a.effect === "zoom" ? 16 : 0;
        } else if (kind === "emph") {
          if (a.effect === "spin") beh = rot(21600000, dur);
          else if (a.effect === "grow") beh = scale(Math.round((a.amount || 1.5) * 100000), dur, false);
          else if (a.effect === "teeter") {
            const q = Math.max(1, Math.round(dur / 4));
            beh = rot(240000, q) + rot(-480000, q, q) + rot(480000, q, 2 * q) + rot(-240000, q, 3 * q);
          } else beh = scale(105000, Math.max(1, Math.round(dur / 2)), true);
        } else {
          const p = (a.path || "M 0 0 E").replace(/"/g, "");
          beh = `<p:animMotion origin="layout" path="${p}" pathEditMode="relative" ptsTypes=""><p:cBhvr><p:cTn id="${nid()}" dur="${dur}" fill="hold"/>${spTgt}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>`;
        }
        const grp = grpOf(tg.spid, a);
        const snd = a.sound && sound?.(a.sound);
        const sub = snd
          ? `<p:subTnLst><p:audio><p:cMediaNode showWhenStopped="0"><p:cTn id="${nid()}" display="0" masterRel="sameClick"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:endCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst></p:cTn><p:tgtEl><p:sndTgt r:embed="${snd.rid}" name="${snd.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"/></p:tgtEl></p:cMediaNode></p:audio></p:subTnLst>`
          : "";
        effs.push(
          `<p:par><p:cTn id="${nid()}" presetID="${PRESET[a.effect] ?? 0}" presetClass="${CLASS[kind]}" presetSubtype="${subtype}"${kind === "path" ? ' accel="50000" decel="50000"' : ""} fill="hold" grpId="${grp}" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${a.delay}"/></p:stCondLst><p:childTnLst>${beh}</p:childTnLst>${sub}</p:cTn></p:par>`,
        );
        if (tg.text) bld.set(`${tg.spid}|${grp}`, tg.para !== undefined ? ' build="p"' : "");
      }
      if (effs.length) inner.push(`<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="${g}"/></p:stCondLst><p:childTnLst>${effs.join("")}</p:childTnLst></p:cTn></p:par>`);
      first = false;
    }
    if (!inner.length) continue;
    // an interactive sequence starts on the trigger's click; its later steps wait for the next one
    const cond = interactive ? `<p:cond delay="${si === 0 ? 0 : "indefinite"}"/>` : st.auto && si === 0 ? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : '<p:cond delay="indefinite"/>';
    stepXml.push(`<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst>${cond}</p:stCondLst><p:childTnLst>${inner.join("")}</p:childTnLst></p:cTn></p:par>`);
  }
  return stepXml;
  };
  const stepXml = seqXml(steps, false);
  // autoplaying media: a "Play" (mediacall) effect when the slide starts, ahead of the first click
  const plays = media.filter((m) => m.autoplay).map((m, k) =>
    `<p:par><p:cTn id="${nid()}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="${k === 0 && !(steps[0]?.auto) ? "afterEffect" : "withEffect"}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${m.spid}"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>`,
  );
  if (plays.length) {
    const group = `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${plays.join("")}</p:childTnLst></p:cTn></p:par>`;
    if (steps[0]?.auto && stepXml.length) stepXml[0] = stepXml[0].replace("<p:childTnLst>", `<p:childTnLst>${group}`);
    else stepXml.unshift(`<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>${group}</p:childTnLst></p:cTn></p:par>`);
  }
  // every media object gets its media node (PowerPoint's player settings; repeat = loop)
  const nodes = media.map((m) =>
    `<p:${m.audio ? "audio" : "video"}><p:cMediaNode vol="80000"><p:cTn id="${nid()}"${m.loop ? ' repeatCount="indefinite"' : ""} fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${m.spid}"/></p:tgtEl></p:cMediaNode></p:${m.audio ? "audio" : "video"}>`,
  ).join("");
  // each trigger's sequence: started, and stepped on, by clicks on the trigger
  const clickOn = (spid: number) => `<p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cond>`;
  const interactive = trig
    .map((t) => {
      const st = seqXml(t.steps, true);
      return st.length
        ? `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${nid()}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst>${clickOn(t.spid)}</p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>${st.join("")}</p:childTnLst></p:cTn><p:nextCondLst>${clickOn(t.spid)}</p:nextCondLst></p:seq>`
        : "";
    })
    .join("");
  if (!stepXml.length && !nodes && !interactive) return "";
  const bldLst = bld.size ? `<p:bldLst>${[...bld].map(([k, b]) => `<p:bldP spid="${k.split("|")[0]}" grpId="${k.split("|")[1]}"${b} animBg="1"/>`).join("")}</p:bldLst>` : "";
  let n = 0; // number the time nodes in document order, as PowerPoint writes them
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    (stepXml.length
      ? `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${stepXml.join("")}</p:childTnLst></p:cTn>` +
        `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
        `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
      : "") +
    `${interactive}${nodes}</p:childTnLst></p:cTn></p:par></p:tnLst>${bldLst}</p:timing>`
  ).replace(/<p:cTn id="\d+"/g, () => `<p:cTn id="${++n}"`);
}

/** Insert transition + timing after <p:cSld>/<p:clrMapOvr> of a slide part. */
export function patchSlideXml(xml: string, transition: string, timing: string): string {
  if (!transition && !timing) return xml;
  const cleaned = xml.replace(/<p:transition[\s\S]*?<\/p:transition>|<p:transition[^>]*\/>/g, "").replace(/<p:timing>[\s\S]*?<\/p:timing>/g, "");
  const marker = cleaned.includes("</p:clrMapOvr>") ? "</p:clrMapOvr>" : "</p:cSld>";
  return cleaned.replace(marker, `${marker}${transition}${timing}`);
}

/** `trigger`: the shape whose clicks play it; `sound`: the relationship of its sound. */
export type ReadAnim = { spid: number; para?: number; anim: Omit<Anim, "order" | "trigger" | "sound">; trigger?: number; sound?: { rid: string; name: string } };

const EFFECT_OF: Record<number, AnimEffect> = { 1: "appear", 2: "fly", 10: "fade", 16: "split", 22: "wipe", 23: "zoom", 53: "zoom", 21: "fade", 9: "fade", 3: "wipe", 12: "fly" };
const EMPH_OF: Record<number, AnimEffect> = { 26: "pulse", 8: "spin", 6: "grow", 32: "teeter", 35: "pulse" };

/** The effects of a slide's main sequence, in order. Unknown emphasis effects become a pulse (`skipped` reports them). */
export function readTiming(sld: XEl): { anims: ReadAnim[]; skipped: boolean } {
  const timing = child(sld, "timing");
  const out: ReadAnim[] = [];
  let skipped = false;
  if (!timing) return { anims: out, skipped };
  // the main sequence, then each trigger's interactive sequence
  const seqs: { root: XEl; trigger?: number }[] = [];
  for (const c of descendants(timing, "cTn")) {
    const nt = attr(c, "nodeType");
    if (nt === "mainSeq") seqs.push({ root: c });
    else if (nt === "interactiveSeq") {
      const tg = num(descendants(child(c, "stCondLst"), "spTgt")[0], "spid");
      if (tg !== undefined) seqs.push({ root: c, trigger: tg });
      else skipped = true;
    }
  }
  for (const { root, trigger } of seqs)
  for (const c of descendants(root, "cTn")) {
    const cls = attr(c, "presetClass");
    if (!cls) continue;
    if (cls !== "entr" && cls !== "exit" && cls !== "emph" && cls !== "path") {
      if (cls !== "mediacall") skipped = true;
      continue;
    }
    const nt = attr(c, "nodeType");
    const start: Anim["start"] = nt === "withEffect" ? "with" : nt === "afterEffect" ? "after" : "click";
    const preset = num(c, "presetID") ?? 10;
    const sub = num(c, "presetSubtype") ?? 0;
    const delayV = attr(child(child(c, "stCondLst"), "cond"), "delay");
    const delay = delayV && delayV !== "indefinite" ? Number(delayV) || 0 : 0;
    const inner = descendants(child(c, "childTnLst"), "cTn");
    const ends = inner.map((x) => (num(x, "dur") ?? 0) * (attr(x, "autoRev") === "1" ? 2 : 1) + (Number(attr(child(child(x, "stCondLst"), "cond"), "delay")) || 0));
    const dur = Math.max(1, ...ends.filter((d) => d > 1));
    const sp = descendants(c, "spTgt")[0];
    const spid = num(sp, "spid");
    if (spid === undefined) continue;
    const pRg = descendants(sp, "pRg")[0];
    let anim: Omit<Anim, "order">;
    if (cls === "path") {
      const m = descendants(c, "animMotion")[0];
      const p = attr(m, "path");
      if (!p) { skipped = true; continue; }
      anim = { kind: "path", effect: "path", path: p.trim(), start, dur, delay };
    } else if (cls === "emph") {
      const effect = EMPH_OF[preset];
      if (!effect) skipped = true;
      anim = { kind: "emph", effect: effect || "pulse", start, dur, delay };
      if (effect === "grow") {
        const by = child(descendants(c, "animScale")[0], "by");
        const x = num(by, "x");
        if (x) anim.amount = Math.round((x / 100000) * 100) / 100;
      }
    } else {
      const effect = EFFECT_OF[preset] || "fade";
      anim = { effect, start, dur: effect === "appear" ? 500 : dur, delay, ...(cls === "exit" ? { kind: "exit" as const } : {}) };
      if ((effect === "fly" || effect === "wipe") && DIR_OF[sub]) anim.dir = DIR_OF[sub];
    }
    const snd = descendants(child(c, "subTnLst"), "sndTgt")[0];
    const rid = snd ? Object.entries(snd.attrs).find(([k]) => k.endsWith(":embed") || k === "embed")?.[1] : undefined;
    out.push({ spid, ...(pRg ? { para: num(pRg, "st") ?? 0 } : {}), anim, ...(trigger !== undefined ? { trigger } : {}), ...(rid ? { sound: { rid, name: attr(snd, "name") || "" } } : {}) });
  }
  return { anims: out, skipped };
}

/** Media settings from a slide's timing: shapes that play automatically and shapes that loop. */
export function readMediaTiming(sld: XEl): { autoplay: Set<number>; loop: Set<number> } {
  const autoplay = new Set<number>(), loop = new Set<number>();
  const timing = child(sld, "timing");
  if (!timing) return { autoplay, loop };
  for (const c of descendants(timing, "cTn")) {
    if (attr(c, "presetClass") !== "mediacall") continue;
    // a Play effect that waits for a click is not autoplay
    if (attr(c, "nodeType") === "clickEffect") continue;
    const cmd = descendants(c, "cmd").find((x) => /^play/i.test(attr(x, "cmd") || ""));
    const spid = num(descendants(cmd, "spTgt")[0], "spid");
    if (cmd && spid !== undefined) autoplay.add(spid);
  }
  for (const n of descendants(timing, "cMediaNode")) {
    const ctn = child(n, "cTn");
    const spid = num(descendants(n, "spTgt")[0], "spid");
    if (spid !== undefined && attr(ctn, "repeatCount") === "indefinite") loop.add(spid);
  }
  return { autoplay, loop };
}
