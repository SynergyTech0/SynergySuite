import { describe, expect, it } from "vitest";
import { accessContact, canUseVault, members } from "../lib/access";
import { isBlob } from "../lib/util";

describe("vault access", () => {
  it("lets in only VAULT_ALLOWED_EMAILS, ignoring case and spaces", () => {
    const env = { VAULT_ALLOWED_EMAILS: " Ann@Example.com, bob@example.com ", ADMIN_EMAILS: "root@example.com" };
    expect(members(env)).toEqual(["ann@example.com", "bob@example.com"]);
    expect(canUseVault("ann@example.com", env)).toBe(true);
    expect(canUseVault("ANN@example.com", env)).toBe(true);
    expect(canUseVault("root@example.com", env)).toBe(false);
  });

  it("falls back to ADMIN_EMAILS, and to nobody", () => {
    expect(canUseVault("root@example.com", { ADMIN_EMAILS: "root@example.com" })).toBe(true);
    expect(canUseVault("root@example.com", { VAULT_ALLOWED_EMAILS: "  ", ADMIN_EMAILS: "root@example.com" })).toBe(true);
    expect(canUseVault("anyone@example.com", {})).toBe(false);
    expect(members({})).toEqual([]);
  });

  it("names a contact only when one is set", () => {
    expect(accessContact({})).toBe("");
    expect(accessContact({ VAULT_ACCESS_CONTACT: "it@example.com" })).toBe("it@example.com");
  });

  it("accepts only base64 blobs", () => {
    expect(isBlob("YWJj+/==")).toBe(true);
    expect(isBlob("abc_-")).toBe(true);
    expect(isBlob("")).toBe(false);
    expect(isBlob("not base64!")).toBe(false);
    expect(isBlob("a".repeat(200_000))).toBe(false);
    expect(isBlob(42)).toBe(false);
  });
});
