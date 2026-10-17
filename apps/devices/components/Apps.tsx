"use client";
// Apps for managed devices: App Store apps for iPhone, iPad and Mac, signed .pkg installers for Macs,
// and managed Google Play apps for Android.
import { Plus } from "lucide-react";
import { useState } from "react";
import { api, useData } from "./client";
import { Modal } from "./Modal";
import { type AppCtx, Badge, Empty, PLATFORM } from "./shared";

const SOURCE = { app_store: "App Store", package: "Package", play: "Google Play" } as const;

export type CatalogApp = {
  id: string; name: string; platform: string; source: "app_store" | "package" | "play"; store_id: string | null; bundle_id: string; version: string;
  url: string | null; auto_install: boolean; installed: number;
};

export function Apps({ app }: { app: AppCtx }) {
  const [apps, reload] = useData<CatalogApp[]>("/api/mdm/apps", app.say);
  const [adding, setAdding] = useState(false);
  const run = (p: Promise<unknown>, msg: string) => p.then(() => { app.say(msg); reload(); }).catch((e) => app.say(e.message));

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Apps</h1>
          <p className="muted">Apps admins install on managed devices, and that people can install on their own from their device&apos;s page. Apps installed this way are removed when the device leaves management.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add app</button>
      </div>
      {!apps ? <p className="muted">Loading…</p> : !apps.length ? (
        <section className="panel"><Empty><h2>No apps yet</h2><p>Add an App Store app by its link, a signed macOS installer package by its download address, or an Android app from Google Play.</p></Empty></section>
      ) : (
        <section className="panel flush">
          <table className="table">
            <thead><tr><th>App</th><th>For</th><th>Source</th><th className="num">Installed</th><th>New devices</th><th /></tr></thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}<div className="rsub">{a.source === "app_store" ? `App Store ${a.store_id}` : a.source === "play" ? a.store_id : `${a.bundle_id} ${a.version}`}</div></td>
                  <td>{PLATFORM[a.platform] ?? a.platform}</td>
                  <td className="muted">{SOURCE[a.source]}</td>
                  <td className="num">{a.installed}</td>
                  <td>
                    <label className="check small"><input type="checkbox" checked={a.auto_install} onChange={(e) => run(api(`/api/mdm/apps/${a.id}`, { method: "PATCH", json: { auto_install: e.target.checked } }), e.target.checked ? "New devices will get it" : "New devices won't get it")} /> Install automatically</label>
                  </td>
                  <td className="nowrap">
                    <button className="btn small" onClick={() => run(api(`/api/mdm/apps/${a.id}/install`, { method: "POST", json: { all: true } }), `Installing ${a.name} on every managed ${a.platform === "darwin" ? "Mac" : a.platform === "android" ? "Android device" : "iPhone and iPad"}`)}>Install on all</button>{" "}
                    <button className="btn small" onClick={() => run(api(`/api/mdm/apps/${a.id}`, { method: "DELETE" }), "Removed from the list")}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="muted small">App Store apps install without asking for an Apple ID on supervised devices with licenses from Apple Business Manager; otherwise the person is asked to sign in to the App Store. Packages must be signed with a Developer ID Installer certificate. Google Play apps install silently on Android work profiles and company phones.</p>
      {adding ? <AddApp app={app} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} /> : null}
    </div>
  );
}

function AddApp({ app, onClose, onSaved }: { app: AppCtx; onClose: () => void; onSaved: () => void }) {
  const [source, setSource] = useState<"app_store" | "package" | "play">("app_store");
  const [platform, setPlatform] = useState("ios");
  const [name, setName] = useState("");
  const [store, setStore] = useState("");
  const [url, setUrl] = useState("");
  const [bundle, setBundle] = useState("");
  const [version, setVersion] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Modal title="Add an app" onClose={onClose}>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        api("/api/mdm/apps", { method: "POST", json: { source, platform, name, store, url, bundle_id: bundle, version, auto_install: auto } })
          .then(() => { app.say(`${name} added`); onSaved(); })
          .catch((x) => setErr(x.message))
          .finally(() => setBusy(false));
      }}>
        <div className="seg" role="tablist">
          <button type="button" className={source === "app_store" ? "on" : ""} onClick={() => setSource("app_store")}>App Store</button>
          <button type="button" className={source === "package" ? "on" : ""} onClick={() => setSource("package")}>Mac package (.pkg)</button>
          <button type="button" className={source === "play" ? "on" : ""} onClick={() => setSource("play")}>Google Play</button>
        </div>
        <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
        {source === "app_store" ? (
          <>
            <label><span>App Store link or number</span><input value={store} onChange={(e) => setStore(e.target.value)} placeholder="https://apps.apple.com/us/app/…/id123456789" required /></label>
            <label><span>For</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="ios">iPhone and iPad</option><option value="darwin">Mac</option></select>
            </label>
          </>
        ) : source === "play" ? (
          <label><span>Google Play link or package name</span><input value={store} onChange={(e) => setStore(e.target.value)} placeholder="https://play.google.com/store/apps/details?id=com.example.app" required /></label>
        ) : (
          <>
            <label><span>Download address (https)</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://files.example.com/app.pkg" required /></label>
            <div className="grid2">
              <label><span>Bundle identifier</span><input value={bundle} onChange={(e) => setBundle(e.target.value)} placeholder="com.example.app" required /></label>
              <label><span>Version</span><input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.0" required /></label>
            </div>
            <p className="muted small">Devices downloads the package once to fingerprint it; Macs download it from this address when they install.</p>
          </>
        )}
        <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Install on devices when they enroll</label>
        <p className="error small">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add"}</button></div>
      </form>
    </Modal>
  );
}

/** Install a catalog app on one device (its owner or an admin). */
export function InstallApp({ app, deviceId, platform, onClose }: { app: AppCtx; deviceId: string; platform: string; onClose: () => void }) {
  const [apps] = useData<CatalogApp[]>("/api/mdm/apps", app.say);
  const list = apps?.filter((a) => a.platform === platform) ?? null;
  return (
    <Modal title="Install an app" onClose={onClose}>
      <div className="form">
        {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">No apps for this device yet{app.me.role === "admin" ? "; add them under Apps" : ""}.</p> : (
          <ul className="plainlist">
            {list.map((a) => (
              <li key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                <span className="grow">{a.name} {a.source === "package" ? <Badge>Package</Badge> : null}</span>
                <button className="btn small primary" onClick={() => api(`/api/mdm/apps/${a.id}/install`, { method: "POST", json: { devices: [deviceId] } }).then(() => { app.say(`Installing ${a.name}`); onClose(); }).catch((e) => app.say(e.message))}>Install</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
