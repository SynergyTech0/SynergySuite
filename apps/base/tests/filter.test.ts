import { describe, expect, it } from "vitest";
import { compile, operatorsFor } from "@/lib/filter";
import type { Field } from "@/lib/fields";

const field = (id: string, type: Field["type"], name = id): Field => ({ id, name, pgName: `f_${id}`, type, options: type === "choice" ? { choices: ["A", "B"] } : {}, required: false, description: "", position: 0 });
const fields = [field("id", "autonumber"), field("t", "text", "Title"), field("n", "number", "Amount"), field("m", "multichoice", "Tags"), field("y", "yesno", "Done")];
fields[0].pgName = "id";
const col = (f: Field) => `"${f.pgName}"`;

describe("compile", () => {
  it("parameterises every value and keeps ID order as the tie-break", () => {
    const params: unknown[] = [];
    const out = compile(fields, col, params, {
      filter: { match: "all", conditions: [{ field: "t", op: "contains", value: "50%_off" }, { field: "n", op: "gte", value: "10" }] },
      sort: [{ field: "t", dir: "desc" }],
    });
    expect(out.where).toBe(`("f_t" ILIKE $1 AND "f_n" >= $2)`);
    expect(params).toEqual(["%50\\%\\_off%", "10"]);
    expect(out.orderBy).toBe(`lower("f_t") DESC NULLS LAST, "id" ASC`);
  });

  it("joins with OR for any, and searches every field", () => {
    const params: unknown[] = [];
    const out = compile(fields, col, params, {
      filter: { match: "any", conditions: [{ field: "y", op: "eq", value: "yes" }, { field: "m", op: "contains", value: "x" }] },
      search: "abc",
    });
    expect(out.where).toContain(`("f_y" = $1 OR $2 = ANY("f_m"))`);
    expect(out.where).toContain(`array_to_string("f_m", ' ') ILIKE $3`);
    expect(params).toEqual([true, "x", "%abc%"]);
  });

  it("refuses bad values, operators and unknown fields with readable errors", () => {
    expect(() => compile(fields, col, [], { filter: { match: "all", conditions: [{ field: "n", op: "gt", value: "lots" }] } })).toThrow(/number/);
    expect(() => compile(fields, col, [], { filter: { match: "all", conditions: [{ field: "y", op: "contains", value: "x" }] } })).toThrow(/can't be filtered/);
    expect(() => compile(fields, col, [], { filter: { match: "all", conditions: [{ field: "zz", op: "eq", value: "x" }] } })).toThrow(/no longer exists/);
    expect(() => compile(fields, col, [], { filter: { match: "all", conditions: [{ field: "t", op: "eq; drop table x" as never, value: "x" }] } })).toThrow();
  });

  it("ignores sorts on unknown fields", () => {
    expect(compile(fields, col, [], { sort: [{ field: "nope", dir: "asc" }] }).orderBy).toBe(`"id" ASC`);
  });

  it("matches lookups on the related record's label, and their IDs exactly", () => {
    const lk = { ...field("c", "lookup", "Customer"), options: { targetTable: "x" } };
    const params: unknown[] = [];
    const out = compile([...fields, lk], { col, label: (f) => (f.type === "lookup" ? `"j_c"."f_name"::text` : null), id: `t."id"` }, params, {
      filter: { match: "all", conditions: [{ field: "c", op: "contains", value: "ada" }, { field: "c", op: "eq", value: "7" }] },
      require: [{ field: "c", op: "eq", value: "9" }],
      sort: [{ field: "c", dir: "asc" }],
    });
    expect(out.where).toBe(`("j_c"."f_name"::text ILIKE $1 AND "f_c" = $2) AND "f_c" = $3`);
    expect(params).toEqual(["%ada%", "7", "9"]);
    expect(out.orderBy).toBe(`lower("j_c"."f_name"::text) ASC NULLS LAST, t."id" ASC`);
    expect(() => compile([lk], col, [], { filter: { match: "all", conditions: [{ field: "c", op: "eq", value: "Ada" }] } })).toThrow(/related record/);
  });

  it("offers operators that fit the type", () => {
    expect(operatorsFor({ type: "yesno" })).toEqual(["eq", "ne"]);
    expect(operatorsFor({ type: "date" })).toContain("lt");
  });
});
