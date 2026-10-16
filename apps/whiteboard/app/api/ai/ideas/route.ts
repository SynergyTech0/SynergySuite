import { body, route } from "@/lib/api";
import { ideas } from "@/lib/ai";

/** Sticky-note ideas from the suite's AI model: { prompt, onBoard } -> { ideas }. */
export const POST = route(async (_me, req) => {
  const b = await body<{ prompt?: string; onBoard?: string }>(req);
  return { ideas: await ideas(b.prompt, b.onBoard) };
});
