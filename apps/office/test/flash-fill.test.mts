// Flash Fill: programs learned from examples and used on the other rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flashFill } from "../lib/flash-fill.ts";

const fill = (inputs: string[][], outputs: (string | null)[]) => flashFill(inputs.map((x, i) => ({ inputs: x, output: outputs[i] ?? null })))?.outputs;

test("first names, last names and initials", () => {
  const names = [["John Smith"], ["Mary Ann Lee"], ["Ravi Patel"], ["Jo Wu"]];
  assert.deepEqual(fill(names, ["John"]), ["John", "Mary", "Ravi", "Jo"]);
  assert.deepEqual(fill(names, ["Smith"]), ["Smith", "Lee", "Patel", "Wu"], "the last word, not the second");
  assert.deepEqual(fill(names, ["Smith, John"]), ["Smith, John", "Lee, Mary", "Patel, Ravi", "Wu, Jo"]);
  assert.deepEqual(fill(names, ["J. Smith"]), ["J. Smith", "M. Lee", "R. Patel", "J. Wu"]);
  assert.deepEqual(fill(names, ["JOHN"]), ["JOHN", "MARY", "RAVI", "JO"]);
});

test("pieces of emails, phone numbers and dates, with text in between", () => {
  assert.deepEqual(fill([["john.smith@example.com"], ["ann.lee@example.org"]], ["John Smith"]), ["John Smith", "Ann Lee"]);
  assert.deepEqual(fill([["(555) 123-4567"], ["(212) 555-0199"]], ["555-123-4567"]), ["555-123-4567", "212-555-0199"]);
  assert.deepEqual(fill([["2024-03-05"], ["1999-12-31"]], ["05/03/2024"]), ["05/03/2024", "31/12/1999"]);
});

test("two input columns, more examples to settle a choice, and rows it can't do", () => {
  assert.deepEqual(fill([["Ann", "Lee"], ["Bo", "Chan"], ["Cy", ""]], ["Ann Lee (A.L.)"]), ["Ann Lee (A.L.)", "Bo Chan (B.C.)", null]);
  // "Mary Ann Lee" -> "Mary Ann": with only one example of two words this would be ambiguous.
  assert.deepEqual(fill([["Mary Ann Lee"], ["Jo Kim Park"], ["Al Bo Cy"]], ["Mary Ann", "Jo Kim"]), ["Mary Ann", "Jo Kim", "Al Bo"]);
  assert.equal(flashFill([{ inputs: ["abc"], output: "xyz" }]) && true, true, "fixed text is a program too");
  assert.equal(flashFill([{ inputs: ["a"], output: null }]), null, "no examples");
  assert.equal(flashFill([{ inputs: ["Ann Lee"], output: "Ann" }, { inputs: ["Bo Chan"], output: "Zed" }]), null, "examples that disagree");
});
