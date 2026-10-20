import { describe, expect, it } from "vitest";
import { isPrivate, vetEndpoint } from "../lib/accounts";

describe("outside account servers", () => {
  it("recognises private and local addresses", () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "172.20.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivate(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.1.1", "172.32.0.1", "2607:f8b0::1"]) expect(isPrivate(ip), ip).toBe(false);
  });

  it("refuses non-mail ports and internal hosts", async () => {
    await expect(vetEndpoint({ host: "8.8.8.8", port: 5432, secure: true })).rejects.toThrow(/not a mail port/);
    await expect(vetEndpoint({ host: "127.0.0.1", port: 993, secure: true })).rejects.toThrow(/not a public mail server/);
    await expect(vetEndpoint({ host: "localhost", port: 993, secure: true })).rejects.toThrow(/not a public mail server/);
  });

  it("pins a public server to the checked address", async () => {
    expect(await vetEndpoint({ host: "8.8.8.8", port: 993, secure: true })).toEqual({ host: "8.8.8.8", port: 993, secure: true, servername: undefined });
  });

  it("keeps the server name when an already pinned endpoint is checked again", async () => {
    // Add account vets the servers, then the IMAP connection vets them again: the certificate
    // must still be checked against outlook.office365.com, not the address it was pinned to.
    const pinned = { host: "8.8.8.8", port: 993, secure: true, servername: "outlook.office365.com" };
    expect(await vetEndpoint(pinned)).toEqual(pinned);
  });
});
