import { describe, expect, it } from "vitest";
import { evalData, FxError, FxSyntaxError, parse, runBehavior, type Host, type Rec, type Value, withRow, withSource } from "@/lib/fx";

const people = withSource(
  [
    withRow({ ID: 1, Name: "Ada", Age: 36, City: "London" }, { source: "People", id: "1" }),
    withRow({ ID: 2, Name: "Grace", Age: 45, City: "New York" }, { source: "People", id: "2" }),
    withRow({ ID: 3, Name: "Linus", Age: 28, City: "Helsinki" }, { source: "People", id: "3" }),
  ] as Rec[],
  "People",
);

const host = (extra: Record<string, Value> = {}): Host => ({ resolve: (n) => (n === "People" ? people : extra[n]) });
const ev = (src: string, extra?: Record<string, Value>) => evalData(src, host(extra));

describe("parsing", () => {
  it("follows Power Fx precedence", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("2 ^ 3 ^ 2")).toBe(512);
    expect(ev(`"a" & 1 + 2`)).toBe("a3");
    expect(ev("1 < 2 And 3 > 4 Or true")).toBe(true);
    expect(ev("Not true || !false")).toBe(true);
    expect(ev("-2 * -3")).toBe(6);
  });
  it("reads text, quoted names and comments", () => {
    expect(ev(`"say ""hi"""`)).toBe('say "hi"');
    expect(ev(`'My Var' & "!" // trailing comment`, { "My Var": "x" })).toBe("x!");
    expect(ev(`/* note */ 5`)).toBe(5);
  });
  it("reports where a syntax error is", () => {
    expect(() => parse("1 + ")).toThrow(FxSyntaxError);
    try {
      parse(`If(true, "a" "b")`);
    } catch (e) {
      expect((e as FxSyntaxError).at).toBe(13);
    }
  });
  it("an empty formula is blank", () => {
    expect(ev("")).toBe(null);
  });
});

describe("values", () => {
  it("compares blank, text and numbers like Power Fx", () => {
    expect(ev(`Blank() = ""`)).toBe(true);
    expect(ev(`IsBlank("")`)).toBe(true);
    expect(ev(`"10" = 10`)).toBe(true);
    expect(ev(`"b" > "a"`)).toBe(true);
    expect(ev(`"ell" in "Hello"`)).toBe(true);
    expect(ev(`"ELL" exactin "Hello"`)).toBe(false);
    expect(ev(`"Ada" in People.Name`)).toBe(true);
  });
  it("does date arithmetic", () => {
    expect(ev(`DateDiff(Date(2026,1,1), Date(2026,3,1))`)).toBe(59);
    expect(ev(`DateDiff(Date(2026,1,31), Date(2027,2,1), TimeUnit.Months)`)).toBe(13);
    expect(ev(`Text(DateAdd(Date(2026,1,31), 1, TimeUnit.Months), "yyyy-mm-dd")`)).toBe("2026-03-03");
    expect(ev(`Text(Date(2026,10,16) + 1, "dddd d mmm yyyy")`)).toBe("Saturday 17 Oct 2026");
    expect(ev(`Text(DateTime(2026,10,16,14,5,0), "hh:mm AM/PM")`)).toBe("02:05 PM");
    expect(ev(`Weekday(Date(2026,10,16))`)).toBe(6);
  });
  it("formats numbers", () => {
    expect(ev(`Text(1234.5, "$#,##0.00")`)).toBe("$1,234.50");
    expect(ev(`Text(0.256, "0%")`)).toBe("26%");
    expect(ev(`Text(3.14159, "0.##")`)).toBe("3.14");
    expect(ev(`Text(7, "000")`)).toBe("007");
    expect(ev(`Value("1,200.5")`)).toBe(1200.5);
    expect(ev(`0.1 + 0.2 & ""`)).toBe("0.3");
  });
  it("divides by zero as an error", () => {
    expect(() => ev("1/0")).toThrow(FxError);
    expect(ev(`IfError(1/0, -1)`)).toBe(-1);
  });
});

describe("text and math", () => {
  it("has the text functions", () => {
    expect(ev(`Upper(Left("hello", 2)) & Mid("hello", 3) & Right("hello", 1)`)).toBe("HEllo" + "o");
    expect(ev(`Substitute("a-b-c", "-", "+", 2)`)).toBe("a-b+c");
    expect(ev(`Proper("ada LOVELACE")`)).toBe("Ada Lovelace");
    expect(ev(`Concat(Split("a,b,c", ","), Upper(Value), "|")`)).toBe("A|B|C");
    expect(ev(`IsMatch("x@y.io", "Email")`)).toBe(true);
    expect(ev(`Find("l", "hello")`)).toBe(3);
    expect(ev(`Trim("  a   b ")`)).toBe("a b");
  });
  it("rounds like Excel", () => {
    expect(ev(`Round(2.5, 0)`)).toBe(3);
    expect(ev(`Round(-2.5, 0)`)).toBe(-3);
    expect(ev(`RoundDown(2.79, 1)`)).toBe(2.7);
    expect(ev(`RoundUp(2.11, 1)`)).toBe(2.2);
    expect(ev(`Mod(-3, 5)`)).toBe(2);
  });
});

describe("tables", () => {
  it("filters, looks up, sorts and aggregates", () => {
    expect(ev(`CountRows(Filter(People, Age > 30))`)).toBe(2);
    expect(ev(`LookUp(People, City = "Helsinki").Name`)).toBe("Linus");
    expect(ev(`LookUp(People, ID = 2, Name & "!")`)).toBe("Grace!");
    expect(ev(`First(SortByColumns(People, "Age", SortOrder.Descending)).Name`)).toBe("Grace");
    expect(ev(`Concat(Sort(People, Len(Name)), Name, ",")`)).toBe("Ada,Grace,Linus");
    expect(ev(`Sum(People, Age)`)).toBe(109);
    expect(ev(`Max(People, Age) - Min(1, 2, 3)`)).toBe(44);
    expect(ev(`Average(People, Age)`)).toBeCloseTo(36.333, 2);
    expect(ev(`CountRows(Search(People, "on", "Name", "City"))`)).toBe(1);
    expect(ev(`CountIf(People, Age < 40)`)).toBe(2);
    expect(ev(`Concat(Filter(People, ThisRecord.ID >= 2), Name, " ")`)).toBe("Grace Linus");
  });
  it("shapes tables", () => {
    expect(ev(`First(AddColumns(People, Older, Age + 10)).Older`)).toBe(46);
    expect(ev(`Concat(ShowColumns(People, Name), Name)`)).toBe("AdaGraceLinus");
    expect(ev(`CountRows(Distinct(People, Age > 30))`)).toBe(2);
    expect(ev(`Concat(ForAll(Sequence(3), Value * 2), Value, ",")`)).toBe("2,4,6");
    expect(ev(`Last(FirstN(People, 2)).Name`)).toBe("Grace");
    expect(ev(`Index(People, 3).Name`)).toBe("Linus");
    expect(ev(`With({x: 2, y: 3}, x * y)`)).toBe(6);
    expect(ev(`CountRows([1, 2, 3])`)).toBe(3);
  });
  it("keeps which data source row a record came from", () => {
    const r = ev(`LookUp(People, ID = 3)`) as Rec;
    expect(r.Name).toBe("Linus");
    expect(ev(`LookUp(People, ID = 3) = Last(People)`)).toBe(true);
  });
});

describe("behavior", () => {
  it("refuses behavior functions in data formulas", () => {
    expect(() => ev(`Navigate(Screen2)`, { Screen2: "s" })).toThrow(/behavior property/);
    expect(() => ev(`Set(x, 1)`)).toThrow(/behavior property/);
  });

  it("runs steps in order and waits for saves", async () => {
    const log: string[] = [];
    const vars: Record<string, Value> = {};
    const h: Host = {
      resolve: (n) => (n === "People" ? people : n in vars ? vars[n] : n === "Screen2" ? "Screen2" : undefined),
      set: (n, v) => {
        vars[n] = v;
        log.push(`set ${n}`);
      },
      navigate: (s) => {
        log.push(`navigate ${s}`);
      },
      patch: async (src, base, changes) => {
        await new Promise((r) => setTimeout(r, 5));
        log.push(`patch ${src} ${base ? "update" : "create"} ${JSON.stringify(changes)}`);
        return { ...(base ?? {}), ...changes, ID: 9 };
      },
    };
    await runBehavior(`Set(n, 1); Set(saved, Patch(People, Defaults(People), {Name: "Joan"})); Navigate(Screen2, ScreenTransition.Fade)`, h);
    expect(log).toEqual(["set n", `patch People create {"Name":"Joan"}`, "set saved", "navigate Screen2"]);
    expect((vars.saved as Rec).ID).toBe(9);
  });

  it("stops at a failed save", async () => {
    const log: string[] = [];
    const h: Host = {
      resolve: (n) => (n === "People" ? people : undefined),
      patch: async () => {
        throw new Error("Saving failed");
      },
      notify: (m) => log.push(m),
    };
    await expect(runBehavior(`Patch(People, First(People), {Age: 1}); Notify("done")`, h)).rejects.toThrow("Saving failed");
    expect(log).toEqual([]);
    // IfError catches it and carries on.
    await runBehavior(`IfError(Patch(People, First(People), {Age: 1}), Notify("could not save")); Notify("done")`, h);
    expect(log).toEqual(["could not save", "done"]);
  });

  it("patches an existing record by its row", async () => {
    const calls: unknown[] = [];
    const h: Host = {
      resolve: (n) => (n === "People" ? people : undefined),
      patch: async (src, base, changes) => {
        calls.push([src, base?.ID, changes]);
        return { ...base, ...changes };
      },
    };
    await runBehavior(`ForAll(Filter(People, Age > 30), Patch(People, ThisRecord, {Age: Age + 1}))`, h);
    expect(calls).toEqual([
      ["People", 1, { Age: 37 }],
      ["People", 2, { Age: 46 }],
    ]);
  });
});
