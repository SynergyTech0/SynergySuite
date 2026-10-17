import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { PlistInteger, buildPlist, dict, parsePlist } from "../lib/mdm/plist";
import { MDM_PROFILE_ID, cleanSettings, enrollmentProfile, settingsProfile } from "../lib/mdm/profiles";
import { applePlatform, securityFacts } from "../lib/mdm/apple";
import { packageManifest, storeId } from "../lib/mdm/catalog";
import { webhookSigned } from "../lib/mdm/nanomdm";

describe("plist", () => {
  it("round-trips every value type", () => {
    const v = {
      s: "a < b & c",
      spaced: "  kept  ",
      n: 42,
      zero: new PlistInteger(0),
      r: 1.5,
      t: true,
      f: false,
      d: new Date("2026-10-16T12:00:00Z"),
      b: Buffer.from("hello"),
      arr: [1, "two", { three: 3 }],
      empty: {},
      none: [],
      skipped: undefined,
    };
    const out = dict(parsePlist(buildPlist(v)));
    expect(out.s).toBe("a < b & c");
    expect(out.spaced).toBe("  kept  ");
    expect(out.n).toBe(42);
    expect(out.zero).toBe(0);
    expect(out.r).toBe(1.5);
    expect(out.t).toBe(true);
    expect(out.f).toBe(false);
    expect((out.d as Date).toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect((out.b as Buffer).toString()).toBe("hello");
    expect(out.arr).toEqual([1, "two", { three: 3 }]);
    expect(out.empty).toEqual({});
    expect(out.none).toEqual([]);
    expect("skipped" in out).toBe(false);
  });

  it("reads what devices send, comments and entities included", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<!-- a comment -->
<dict>
	<key>MessageType</key>
	<string>Authenticate</string>
	<key>DeviceName</key>
	<string>Alice&#x2019;s iPhone</string>
	<key>Empty</key>
	<string/>
	<key>Data</key>
	<data>
	aGVs
	bG8=
	</data>
</dict>
</plist>`;
    expect(parsePlist(xml)).toEqual({ MessageType: "Authenticate", DeviceName: "Alice’s iPhone", Empty: "", Data: Buffer.from("hello") });
  });

  it("refuses what isn't a plist", () => {
    expect(() => parsePlist("<html></html>")).toThrow();
    expect(() => parsePlist("<plist><dict><key>a</key></dict></plist>")).toThrow();
  });
});

describe("profiles", () => {
  it("builds an enrollment profile with SCEP and MDM payloads", () => {
    const p = dict(parsePlist(enrollmentProfile({ base: "https://devices.example.com", topic: "com.apple.mgmt.External.abc", challenge: "ch", token: "tok", organization: "Acme" })));
    expect(p.PayloadType).toBe("Configuration");
    const payloads = (p.PayloadContent as unknown[]).map(dict);
    const scep = payloads.find((x) => x.PayloadType === "com.apple.security.scep")!;
    const mdm = payloads.find((x) => x.PayloadType === "com.apple.mdm")!;
    expect(dict(scep.PayloadContent).URL).toBe("https://devices.example.com/scep");
    expect(dict(scep.PayloadContent).Challenge).toBe("ch");
    expect(mdm.Topic).toBe("com.apple.mgmt.External.abc");
    expect(mdm.ServerURL).toBe("https://devices.example.com/mdm/apple/mdm?enroll=tok");
    expect(mdm.SignMessage).toBe(true);
    expect(mdm.IdentityCertificateUUID).toBe(scep.PayloadUUID);
    expect(p.PayloadIdentifier).toBe(MDM_PROFILE_ID);
  });

  it("validates settings and builds payloads", () => {
    expect(() => cleanSettings("passcode", { min_length: 2 })).toThrow(/Minimum length/);
    expect(() => cleanSettings("wifi", { ssid: "Office", password: "short" })).toThrow(/8 to 63/);
    const s = cleanSettings("passcode", { min_length: "8", require_alphanumeric: true });
    const doc = dict(parsePlist(settingsProfile({ id: "p1", name: "Passcode", description: "", kind: "passcode", settings: s, organization: "Acme" }).xml));
    const pay = dict((doc.PayloadContent as unknown[])[0]);
    expect(pay.PayloadType).toBe("com.apple.mobiledevice.passwordpolicy");
    expect(pay.minLength).toBe(8);
    expect(pay.requireAlphanumeric).toBe(true);
  });

  it("takes unsigned custom profiles, never an enrollment profile", () => {
    const custom = buildPlist({ PayloadType: "Configuration", PayloadIdentifier: "x", PayloadUUID: "u", PayloadVersion: 1, PayloadContent: [{ PayloadType: "com.apple.dock", PayloadIdentifier: "x.d", PayloadUUID: "u2", PayloadVersion: 1 }] });
    expect(cleanSettings("custom", { mobileconfig: custom }).payload_types).toEqual(["com.apple.dock"]);
    const enroll = enrollmentProfile({ base: "https://d", topic: "t", challenge: "c", token: "k", organization: "o" });
    expect(() => cleanSettings("custom", { mobileconfig: enroll })).toThrow(/Enrollment profiles/);
    expect(() => cleanSettings("custom", { mobileconfig: "0\u0082signed" })).toThrow(/unsigned/);
    const doc = dict(parsePlist(settingsProfile({ id: "p2", name: "Dock", description: "", kind: "custom", settings: cleanSettings("custom", { mobileconfig: custom }), organization: "Acme" }).xml));
    expect(doc.PayloadIdentifier).toBe("cloud.synergy.devices.profile.p2");
  });
});

describe("apple facts", () => {
  it("tells phones from Macs", () => {
    expect(applePlatform("", "iPhone15,2")).toBe("ios");
    expect(applePlatform("iPad Pro", "")).toBe("ios");
    expect(applePlatform("MacBookPro18,3", "MacBookPro18,3")).toBe("darwin");
  });

  it("maps security info to compliance facts", () => {
    expect(securityFacts("ios", { PasscodePresent: true, HardwareEncryptionCaps: 3 })).toEqual({ screen_lock: true, disk_encryption: true });
    expect(securityFacts("ios", { PasscodePresent: false, HardwareEncryptionCaps: 3 })).toEqual({ screen_lock: false, disk_encryption: false });
    expect(securityFacts("ios", {})).toEqual({ screen_lock: null, disk_encryption: null });
    expect(securityFacts("darwin", { FDE_Enabled: true, FirewallSettings: { FirewallEnabled: false }, SystemIntegrityProtectionEnabled: true }))
      .toEqual({ disk_encryption: true, firewall: false, system_protection: true });
  });
});

describe("apps", () => {
  it("reads App Store links and numbers", () => {
    expect(storeId("https://apps.apple.com/us/app/slack/id618783545")).toBe("618783545");
    expect(storeId("https://apps.apple.com/us/app/slack/id618783545?mt=8")).toBe("618783545");
    expect(storeId("618783545")).toBe("618783545");
    expect(() => storeId("slack")).toThrow();
  });

  it("hashes packages in 10 MB chunks", async () => {
    const size = 10 * 1024 * 1024 + 5;
    const fake = (async () => new Response(Buffer.alloc(size, 1))) as unknown as typeof fetch;
    const m = await packageManifest("https://example.com/a.pkg", { bundle_id: "com.example.a", version: "1.0", name: "A" }, fake);
    const asset = m.items[0].assets[0];
    expect(asset.sha256s).toHaveLength(2);
    expect(m.items[0].metadata.sizeInBytes).toBe(size);
    await expect(packageManifest("http://example.com/a.pkg", { bundle_id: "a", version: "1", name: "A" }, fake)).rejects.toThrow(/https/);
  });
});

describe("webhook signature", () => {
  const env = { DEVICES_MDM_URL: "http://mdm", DEVICES_MDM_API_KEY: "k", DEVICES_MDM_WEBHOOK_KEY: "hook", DEVICES_SCEP_CHALLENGE: "c" } as unknown as NodeJS.ProcessEnv;
  it("accepts NanoMDM's HMAC and nothing else", () => {
    const body = Buffer.from('{"topic":"mdm.Connect"}');
    const sig = createHmac("sha256", "hook").update(body).digest("base64");
    expect(webhookSigned(body, sig, env)).toBe(true);
    expect(webhookSigned(Buffer.from('{"topic":"mdm.CheckOut"}'), sig, env)).toBe(false);
    expect(webhookSigned(body, null, env)).toBe(false);
    expect(webhookSigned(body, sig, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
