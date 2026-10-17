import { body, route } from "@/lib/api";
import { PRESETS, computeDeadline, extraHolidays } from "@/lib/deadlines";
import { UserError } from "@/lib/util";

/** Works out a due date: `{ from, days, count, mail }`, or `{ from, preset, mail }`. */
export const POST = route(async (_me, req) => {
  const b = await body<{ from?: string; days?: number | string; count?: string; mail?: boolean; preset?: string }>(req);
  const preset = b.preset ? PRESETS.find((p) => p.id === b.preset) : undefined;
  if (b.preset && !preset) throw new UserError("Unknown rule");
  const days = preset ? preset.days : Number(b.days);
  const count = preset ? preset.count : b.count === "court" ? "court" : "calendar";
  try {
    const out = computeDeadline(String(b.from ?? ""), days, { count, mail: !!b.mail, extra: extraHolidays() });
    return { ...out, basis: preset?.basis ?? "", label: preset?.label ?? "" };
  } catch (e) {
    throw new UserError((e as Error).message);
  }
});
