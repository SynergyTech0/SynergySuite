// What a collaboration message would change, and whether a non-owner may
// change it under the sheet's protections (rules in lib/protection-rules.mjs).
import * as Y from "yjs";
import { foldProtections, protectionsOf, sameProtections, violation } from "../lib/protection-rules.mjs";

/** The Yjs update inside a sync message, or null for any other message
 *  (awareness, auth, the state-vector step of a sync). */
export function syncUpdateOf(data) {
  let pos = 0;
  const varUint = () => {
    let n = 0;
    let mult = 1;
    for (;;) {
      if (pos >= data.length) throw new Error("short");
      const b = data[pos++];
      n += (b & 0x7f) * mult;
      if (b < 0x80) return n;
      mult *= 128;
    }
  };
  try {
    const nameLength = varUint(); // document name
    pos += nameLength;
    if (varUint() !== 0) return null; // not a sync message
    const step = varUint();
    if (step !== 1 && step !== 2) return null; // step 1 carries only a state vector
    const len = varUint();
    return data.subarray(pos, pos + len);
  } catch {
    return null;
  }
}

/** Sheet ops and workbook replacements inside a Yjs update, in order. */
export function scanUpdate(change) {
  let decoded;
  try {
    decoded = Y.decodeUpdate(change);
  } catch {
    return null; // Yjs rejects a malformed update the usual way
  }
  const ops = [];
  let base = null;
  for (const struct of decoded.structs) {
    const values = struct?.content?.arr || (typeof struct?.content?.str === "string" ? [struct.content.str] : []);
    for (const v of values) {
      if (typeof v !== "string" || v.length < 2 || v[0] !== "{") continue;
      if (v.startsWith('{"id":')) {
        try {
          const op = JSON.parse(v);
          if (op?.id) ops.push(op);
        } catch {
          /* not an op */
        }
      } else if (v.includes('"sheetOrder"')) base = v;
    }
  }
  return { ops, base, deletes: decoded.ds?.clients?.size > 0 };
}

/**
 * Why the change is refused, or null. `current` is the protection list now;
 * `hasBase` whether the shared workbook already exists.
 */
export function judgeChange(change, current, actor, hasBase) {
  if (actor?.role === "owner") return null;
  const { ops, base, deletes } = change;
  if (base || deletes) {
    // Replacing the whole workbook (opening a file, compacting the log) or
    // deleting from the log would sidestep the per-edit check, so only the
    // owner may do it while anything is protected. Seeding the first shared
    // copy is fine when it carries the stored protections unchanged.
    let incoming = [];
    try {
      incoming = base ? protectionsOf(JSON.parse(base)) : [];
    } catch {
      /* unreadable base: judged on the current protections alone */
    }
    const seeding = base && !hasBase;
    if (seeding ? !sameProtections(incoming, current) : current.length || incoming.length) return "only the owner can replace a protected workbook";
  }
  let list = current;
  for (const op of ops) {
    const why = violation(list, op, actor);
    if (why) return why;
    list = foldProtections(list, op);
  }
  return null;
}
