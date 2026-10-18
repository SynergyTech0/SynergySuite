import { describe, expect, it } from "vitest";
import { csvFields, e164, optKeyword, tags } from "../lib/util";

describe("sms helpers", () => {
  it("normalises North American numbers", () => {
    expect(e164("(555) 123-4567", "1")).toBe("+15551234567");
    expect(e164("1 555 123 4567", "1")).toBe("+15551234567");
    expect(e164("+1 555 123 4567", "1")).toBe("+15551234567");
    expect(e164("123", "1")).toBe("");
    expect(e164("", "1")).toBe("");
  });

  it("keeps international numbers and uses the default country code", () => {
    expect(e164("+44 7700 900123", "1")).toBe("+447700900123");
    expect(e164("0044 7700 900123", "1")).toBe("+447700900123");
    expect(e164("07700 900123", "44")).toBe("+447700900123");
    expect(e164("+0 1234 5678", "1")).toBe("");
  });

  it("cleans tags", () => {
    expect(tags(" VIP, newsletter;vip ,, ")).toEqual(["vip", "newsletter"]);
    expect(tags(["A", "b"])).toEqual(["a", "b"]);
    expect(tags(undefined)).toEqual([]);
  });

  it("recognises opt-out and opt-in words", () => {
    expect(optKeyword("STOP")).toBe("stop");
    expect(optKeyword(" Unsubscribe. ")).toBe("stop");
    expect(optKeyword("start")).toBe("start");
    expect(optKeyword("please stop texting me")).toBeNull();
    expect(optKeyword("hello")).toBeNull();
  });

  it("splits CSV lines with quotes", () => {
    expect(csvFields('+15551234567,"Doe, Jane","vip, newsletter"')).toEqual(["+15551234567", "Doe, Jane", "vip, newsletter"]);
    expect(csvFields('5551234567,"Say ""hi"""')).toEqual(["5551234567", 'Say "hi"']);
    expect(csvFields("5551234567")).toEqual(["5551234567"]);
  });
});
