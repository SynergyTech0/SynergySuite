import { cleanBlocks, starterBlocks } from "./blocks";
import { q, tx } from "./db";
import { keepHeld } from "./ediscovery";
import { assertCanEdit } from "./members";
import type { Block, Ctx, Template } from "./types";
import { UserError, isUuid, required, text } from "./util";

/** Saved email designs to start campaigns and automations from. */

type Row = { id: string; name: string; subject: string; preheader: string; blocks: Block[]; updated_at: Date; created_by: string | null };
const toTemplate = (r: Row): Template => ({
  id: r.id, name: r.name, subject: r.subject, preheader: r.preheader, blocks: r.blocks ?? [], updatedAt: new Date(r.updated_at).toISOString(), createdBy: r.created_by,
});

export async function listTemplates(): Promise<Template[]> {
  return (await q<Row>("SELECT * FROM templates ORDER BY updated_at DESC")).map(toTemplate);
}

export async function getTemplate(id: string): Promise<Template> {
  if (!isUuid(id)) throw new UserError("Template not found", 404);
  const [r] = await q<Row>("SELECT * FROM templates WHERE id = $1", [id]);
  if (!r) throw new UserError("Template not found", 404);
  return toTemplate(r);
}

export async function createTemplate(ctx: Ctx, b: Record<string, unknown>): Promise<Template> {
  assertCanEdit(ctx);
  const blocks = b.blocks === undefined ? starterBlocks() : cleanBlocks(b.blocks);
  const [r] = await q<{ id: string }>(
    "INSERT INTO templates (name, subject, preheader, blocks, created_by, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5, $5) RETURNING id",
    [required(b.name, "A name", 120), text(b.subject, 200), text(b.preheader, 200), JSON.stringify(blocks), ctx.email],
  );
  return getTemplate(r.id);
}

export async function updateTemplate(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Template> {
  assertCanEdit(ctx);
  const t = await getTemplate(id);
  await q("UPDATE templates SET name = $2, subject = $3, preheader = $4, blocks = $5::jsonb, updated_at = now(), updated_by = $6 WHERE id = $1", [
    id,
    b.name === undefined ? t.name : required(b.name, "A name", 120),
    b.subject === undefined ? t.subject : text(b.subject, 200),
    b.preheader === undefined ? t.preheader : text(b.preheader, 200),
    JSON.stringify(b.blocks === undefined ? t.blocks : cleanBlocks(b.blocks)),
    ctx.email,
  ]);
  return getTemplate(id);
}

export async function deleteTemplate(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx);
  await getTemplate(id);
  await tx(async (tq) => {
    await keepHeld(tq, ctx.email, "template", [id]);
    await tq("DELETE FROM templates WHERE id = $1", [id]);
  });
}
