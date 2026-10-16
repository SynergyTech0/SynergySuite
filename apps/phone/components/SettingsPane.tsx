"use client";
import { useEffect, useRef, useState } from "react";
import { Circle, Mic, Square, Trash2 } from "lucide-react";
import { api, blobToWav } from "./client";
import type { Me } from "./PhoneApp";

type Settings = Me["settings"];

/** Your call settings: do not disturb, forwarding, ringing your mobile too, and voicemail. */
export function SettingsPane({ me, onSaved, onError }: { me: Me; onSaved: (s: Settings) => void; onError: (e: unknown) => void }) {
  const [s, setS] = useState<Settings>(me.settings);
  const [forwardMode, setForwardMode] = useState<"off" | "on">(me.settings.forwardTo ? "on" : "off");
  const [saved, setSaved] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [greetingKey, setGreetingKey] = useState(0);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => setS(me.settings), [me.settings]);

  async function save(patch: Partial<Settings>) {
    const next = { ...s, ...patch };
    setS(next);
    try {
      const out = await api<Settings>("/api/settings", { method: "PUT", json: next });
      setS(out);
      onSaved(out);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      onError(e);
      setS(me.settings);
    }
  }

  async function record() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        try {
          const wav = await blobToWav(new Blob(chunks.current, { type: rec.mimeType }));
          await api("/api/settings/greeting", { method: "PUT", body: wav, headers: { "Content-Type": "audio/wav" } });
          setGreetingKey((k) => k + 1);
          onSaved({ ...s, hasGreetingAudio: true });
          setS((x) => ({ ...x, hasGreetingAudio: true }));
        } catch (e) {
          onError(e);
        }
      };
      rec.start();
      setRecording(rec);
      // A greeting is short; stop on its own after a minute.
      setTimeout(() => rec.state === "recording" && rec.stop(), 60_000);
    } catch (e) {
      onError(e instanceof DOMException ? new Error("Phone needs your microphone to record a greeting") : e);
    }
  }

  async function removeGreeting() {
    await api("/api/settings/greeting", { method: "DELETE" }).catch(onError);
    setS((x) => ({ ...x, hasGreetingAudio: false }));
    onSaved({ ...s, hasGreetingAudio: false });
  }

  return (
    <section className="settings">
      {saved && <div className="savedtag ok small">Saved</div>}
      <div className="setting">
        <div className="grow">
          <h2>Do not disturb</h2>
          <p className="muted small">Calls don&apos;t ring; they go straight to voicemail.</p>
        </div>
        <Switch on={s.dnd} onChange={(v) => void save({ dnd: v })} label="Do not disturb" />
      </div>

      <div className="setting col">
        <div className="settinghead">
          <div className="grow">
            <h2>Forward calls</h2>
            <p className="muted small">Send every call to a colleague or another phone. {me.number ? "" : "Forwarding to a phone number needs a number of your own."}</p>
          </div>
          <Switch on={forwardMode === "on"} onChange={(v) => {
            setForwardMode(v ? "on" : "off");
            if (!v) void save({ forwardTo: null });
          }} label="Forward calls" />
        </div>
        {forwardMode === "on" && (
          <form className="inline" onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get("fwd");
            void save({ forwardTo: String(v ?? "") || null });
          }}>
            <input name="fwd" defaultValue={s.forwardTo ?? ""} placeholder="Email or phone number" aria-label="Forward to" />
            <button className="btn small primary">Save</button>
          </form>
        )}
      </div>

      <div className="setting col">
        <div className="settinghead">
          <div className="grow">
            <h2>Also ring</h2>
            <p className="muted small">Ring your mobile at the same time; whichever you answer first gets the call.</p>
          </div>
        </div>
        <form className="inline" onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("also");
          void save({ alsoRing: String(v ?? "") || null });
        }}>
          <input name="also" defaultValue={s.alsoRing ?? ""} placeholder="+1 555 123 4567" disabled={!me.canCallOut} aria-label="Also ring this number" />
          <button className="btn small" disabled={!me.canCallOut}>Save</button>
        </form>
        {!me.canCallOut && <p className="muted small">Needs a phone number of your own that can call out.</p>}
      </div>

      <div className="setting">
        <div className="grow">
          <h2>Ring for</h2>
          <p className="muted small">Before an unanswered call goes to voicemail.</p>
        </div>
        <select value={s.ringSeconds} onChange={(e) => void save({ ringSeconds: Number(e.target.value) })} aria-label="Ring for">
          {[10, 15, 20, 25, 30, 45, 60].map((n) => <option key={n} value={n}>{n} seconds</option>)}
        </select>
      </div>

      <div className="setting col">
        <div className="settinghead">
          <div className="grow">
            <h2>Voicemail</h2>
            <p className="muted small">Callers you miss can leave a message. Messages are transcribed when your admin has set up a speech model.</p>
          </div>
          <Switch on={s.voicemail} onChange={(v) => void save({ voicemail: v })} label="Voicemail" />
        </div>
        {s.voicemail && (
          <>
            <h3>Greeting</h3>
            {s.hasGreetingAudio ? (
              <div className="inline">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio key={greetingKey} controls src={`/api/settings/greeting?v=${greetingKey}`} />
                <button className="iconbtn" title="Use the spoken greeting instead" aria-label="Delete recorded greeting" onClick={() => void removeGreeting()}><Trash2 size={16} /></button>
              </div>
            ) : (
              <form className="col" onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get("greeting");
                void save({ greetingText: String(v ?? "") });
              }}>
                <textarea name="greeting" rows={3} defaultValue={s.greetingText} placeholder={`You have reached ${me.name}. Please leave a message after the tone.`} aria-label="Greeting text" />
                <div className="inline">
                  <button className="btn small">Save text</button>
                  <span className="muted small">Read out by the computer voice, or record your own:</span>
                </div>
              </form>
            )}
            <div className="inline">
              {recording ? (
                <button className="btn small danger" onClick={() => recording.stop()}><Square size={14} /> Stop and save</button>
              ) : (
                <button className="btn small" onClick={() => void record()}><Circle size={14} className="rec" /> {s.hasGreetingAudio ? "Record again" : "Record a greeting"}</button>
              )}
              {recording && <span className="small recording"><Mic size={14} /> Recording…</span>}
            </div>
          </>
        )}
      </div>
      <p className="muted small credits">
        Synergy Phone is built on <a href="https://github.com/livekit/livekit" target="_blank" rel="noreferrer">LiveKit</a> and{" "}
        <a href="https://github.com/livekit/sip" target="_blank" rel="noreferrer">LiveKit SIP</a> (Apache-2.0), with greetings spoken by{" "}
        <a href="https://github.com/espeak-ng/espeak-ng" target="_blank" rel="noreferrer">eSpeak NG</a>.
      </p>
    </section>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}
