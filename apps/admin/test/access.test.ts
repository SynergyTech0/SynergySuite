import { describe, expect, it } from "vitest";
import { accessEnv, can, configuredAdmins, decide } from "../lib/access";

describe("access", () => {
  const listed = accessEnv({ ADMIN_EMAILS: " Admin@Example.com, other@example.com ", NODE_ENV: "production" } as NodeJS.ProcessEnv);

  it("makes ADMIN_EMAILS admins, case-insensitively", () => {
    expect(listed.adminEmails).toEqual(["admin@example.com", "other@example.com"]);
    expect(decide("ADMIN@example.com", listed, null)).toEqual({ kind: "ok", role: "admin" });
    expect(decide("someone@example.com", listed, null)).toEqual({ kind: "none" });
    expect(decide("someone@example.com", listed, "ediscovery")).toEqual({ kind: "ok", role: "ediscovery" });
  });

  it("in development without ADMIN_EMAILS, makes the dev user the admin", () => {
    const dev = accessEnv({ DEV_USER_EMAIL: "shane@example.com", NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(decide("shane@example.com", dev, null)).toEqual({ kind: "ok", role: "admin" });
    expect(decide("bob@example.com", dev, null)).toEqual({ kind: "none" });
    expect(configuredAdmins(dev)).toEqual({ emails: ["shane@example.com"], source: "DEV_USER_EMAIL" });
  });

  it("in production without ADMIN_EMAILS, refuses everyone, even granted roles and the dev user", () => {
    const prod = accessEnv({ DEV_USER_EMAIL: "shane@example.com", NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(decide("shane@example.com", prod, null)).toEqual({ kind: "setup" });
    expect(decide("bob@example.com", prod, "ediscovery")).toEqual({ kind: "setup" });
    expect(configuredAdmins(prod).source).toBe("none");
  });

  it("keeps eDiscovery managers to Compliance", () => {
    for (const w of ["people", "apps", "roles", "audit", "retention.edit", "matters.all"] as const) {
      expect(can("ediscovery", w)).toBe(false);
      expect(can("admin", w)).toBe(true);
    }
    expect(can("ediscovery", "compliance")).toBe(true);
  });
});
