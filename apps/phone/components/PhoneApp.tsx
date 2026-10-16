"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft, BellOff, Delete, Grid3x3, Mic, MicOff, Pause, Phone, PhoneCall, PhoneForwarded, PhoneIncoming, PhoneMissed,
  PhoneOff, PhoneOutgoing, Play, Settings2, Trash2, UserPlus, Users, Video, Voicemail as VoicemailIcon, X,
} from "lucide-react";
import { DTMF, Tones, api, clock, initials, looksLikeNumber, when } from "./client";
import { type ActiveCall, useCall } from "./useCall";
import { SettingsPane } from "./SettingsPane";

export type Me = {
  email: string; name: string; admin: boolean; number: string | null; numberDisplay: string; canCallOut: boolean;
  settings: { dnd: boolean; forwardTo: string | null; alsoRing: string | null; voicemail: boolean; ringSeconds: number; greetingText: string; hasGreetingAudio: boolean };
  unheardVoicemail: number; configured: boolean;
};
type Person = { email: string; name: string; number: string | null; numberLabel: string };
type HistoryItem = {
  id: string; direction: "in" | "out"; other: string; otherName: string; otherNumber: string | null; state: string; missed: boolean;
  reason: string | null; at: string; durationS: number | null; meeting: boolean; hasVoicemail: boolean;
};
type Voicemail = {
  id: string; callId: string | null; from: string; fromName: string; fromNumber: string | null; durationMs: number;
  transcript: string | null; transcriptError: string | null; heard: boolean; at: string;
};
type Ring = { id: string; room: string; from: string; fromName: string; fromNumber: string | null; toNumber: string | null; direction: string; via: string | null };
type Join = { callId: string; room: string; token: string; url: string; state: string; direction: ActiveCall["direction"]; iceServers?: RTCIceServer[] };

type Tab = "calls" | "voicemail" | "settings";

export function PhoneApp({ initialMe, initialTo, initialTab }: { initialMe: Me; initialTo: string; initialTab: Tab }) {
  const [me, setMe] = useState(initialMe);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dial, setDial] = useState(initialTo);
  const [suggest, setSuggest] = useState<Person[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [missedOnly, setMissedOnly] = useState(false);
  const [voicemail, setVoicemail] = useState<Voicemail[]>([]);
  const [rings, setRings] = useState<Ring[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ringTone = useRef<Tones | null>(null);

  const reload = useCallback(async () => {
    const [h, v, m] = await Promise.all([
      api<HistoryItem[]>("/api/calls").catch(() => null),
      api<Voicemail[]>("/api/voicemail").catch(() => null),
      api<Me>("/api/me").catch(() => null),
    ]);
    if (h) setHistory(h);
    if (v) setVoicemail(v);
    if (m) setMe(m);
  }, []);

  const { call, join, serverState, mute, hold, dtmf, leave, tones } = useCall(() => void reload());

  useEffect(() => {
    void reload();
    // The suite header on other apps opens "Answer in Phone" in this tab when it's open.
    window.name = "synergy-phone";
  }, [reload]);

  const flash = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setTimeout(() => setError(""), 6000);
  };

  // Live events: ringing, the call changing, new voicemail.
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      es = new EventSource("/api/events");
      es.onmessage = (m) => {
        let e: { type: string; [k: string]: unknown };
        try {
          e = JSON.parse(m.data);
        } catch {
          return;
        }
        if (e.type === "ring") {
          const r = e.call as Ring;
          setRings((list) => (list.some((x) => x.id === r.id) ? list : [...list, r]));
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
            const n = new Notification(`Call from ${r.fromName}`, { body: r.via ? `Put through by ${r.via}` : "Synergy Phone", tag: r.id, requireInteraction: true });
            n.onclick = () => {
              window.focus();
              n.close();
            };
          }
        } else if (e.type === "ring-stop") {
          setRings((list) => list.filter((x) => x.id !== e.callId));
        } else if (e.type === "call") {
          serverState(String(e.callId), String(e.state), e.detail as string | undefined);
        } else if (e.type === "voicemail" || e.type === "history") {
          void reload();
        }
      };
      es.onerror = () => {
        es?.close();
        retry = setTimeout(open, 3000);
      };
    };
    open();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [reload, serverState]);

  // The ringtone plays while anything rings and we aren't already on a call.
  useEffect(() => {
    ringTone.current ??= new Tones();
    if (rings.length && !call) ringTone.current.ring();
    else ringTone.current.stop();
    return () => ringTone.current?.stop();
  }, [rings.length, call]);

  // Suggestions as you type a name.
  useEffect(() => {
    const s = dial.trim();
    if (!s || (looksLikeNumber(s) && s.replace(/\D/g, "").length > 4)) {
      setSuggest([]);
      return;
    }
    const t = setTimeout(() => {
      api<Person[]>(`/api/directory?q=${encodeURIComponent(s)}`).then(setSuggest, () => setSuggest([]));
    }, 150);
    return () => clearTimeout(t);
  }, [dial]);

  const askForNotifications = () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  };

  async function startCall(to: string, label?: string) {
    const target = to.trim();
    if (!target || call || busy) return;
    askForNotifications();
    setBusy(true);
    try {
      const j = await api<Join>("/api/calls", { method: "POST", json: { to: target } });
      await join(j, { title: label || target, subtitle: j.direction === "outbound" ? "Calling…" : "Ringing…", outgoing: true });
      setDial("");
      setSuggest([]);
      void reload();
    } catch (e) {
      flash(e);
    } finally {
      setBusy(false);
    }
  }

  async function answer(r: Ring) {
    askForNotifications();
    setRings((list) => list.filter((x) => x.id !== r.id));
    try {
      if (call && call.state !== "ended" && call.callId !== r.id) await hangup(call);
      const j = await api<Join>(`/api/calls/${r.id}/answer`, { method: "POST" });
      await join(j, { title: r.fromName, subtitle: r.fromNumber && r.fromName !== r.fromNumber ? r.fromNumber : r.from, outgoing: false });
    } catch (e) {
      flash(e);
    }
  }

  async function declineRing(r: Ring) {
    setRings((list) => list.filter((x) => x.id !== r.id));
    await api(`/api/calls/${r.id}/decline`, { method: "POST" }).catch(flash);
  }

  async function hangup(c: ActiveCall) {
    leave();
    await api(`/api/calls/${c.callId}/hangup`, { method: "POST" }).catch(() => {});
    tones().blip([480, 620], 250);
    void reload();
  }

  const unheard = voicemail.filter((v) => !v.heard).length;
  const shown = missedOnly ? history.filter((h) => h.missed) : history;

  return (
    <div className="phone">
      <aside className="dialer">
        <div className="mynumber">
          <div className="avatar big">{initials(me.name)}</div>
          <div className="grow">
            <div className="strong">{me.name}</div>
            <div className="muted small">{me.number ? `Your number ${me.numberDisplay}` : "No phone number yet: calls with colleagues only"}</div>
          </div>
        </div>
        {!me.configured && (
          <div className="notice">Calling isn&apos;t set up on this server yet. {me.admin ? <a href="/admin">Set it up</a> : "Ask your admin to set up Phone."}</div>
        )}
        {me.settings.dnd && (
          <button className="notice warn" onClick={() => setTab("settings")}><BellOff size={15} /> Do not disturb is on: calls go to voicemail</button>
        )}
        {me.settings.forwardTo && !me.settings.dnd && (
          <button className="notice" onClick={() => setTab("settings")}><PhoneForwarded size={15} /> Forwarding calls to {me.settings.forwardTo}</button>
        )}
        <form
          className="dialbox"
          onSubmit={(e) => {
            e.preventDefault();
            const pick = suggest.length === 1 ? suggest[0] : null;
            void startCall(pick ? pick.email : dial, pick?.name);
          }}
        >
          <input
            value={dial}
            onChange={(e) => setDial(e.target.value)}
            placeholder="Type a name or number"
            aria-label="Name or number to call"
            autoFocus
          />
          {dial && (
            <button type="button" className="iconbtn" aria-label="Clear" onClick={() => setDial((d) => d.slice(0, -1))}><Delete size={18} /></button>
          )}
          {suggest.length > 0 && (
            <div className="suggestions">
              {suggest.map((p) => (
                <button type="button" key={p.email} onClick={() => void startCall(p.email, p.name)}>
                  <span className="avatar">{initials(p.name)}</span>
                  <span className="grow">
                    <span className="strong">{p.name}</span>
                    <span className="muted small">{p.numberLabel || p.email}</span>
                  </span>
                  <Phone size={16} />
                </button>
              ))}
            </div>
          )}
        </form>
        <Keypad
          onKey={(k) => {
            tones().blip(DTMF[k], 90);
            setDial((d) => d + k);
          }}
        />
        <button className="callbtn" disabled={!dial.trim() || Boolean(call) || busy} onClick={() => void startCall(dial)}>
          <Phone size={20} /> Call
        </button>
        {!me.canCallOut && me.number && <p className="muted small center">Your number can take calls; calling out needs its trunk finished in Phone admin.</p>}
      </aside>

      <main className="panel">
        <nav className="tabs">
          <button className={tab === "calls" ? "on" : ""} onClick={() => setTab("calls")}><PhoneCall size={16} /> Calls</button>
          <button className={tab === "voicemail" ? "on" : ""} onClick={() => setTab("voicemail")}>
            <VoicemailIcon size={16} /> Voicemail {unheard > 0 && <span className="badge">{unheard}</span>}
          </button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}><Settings2 size={16} /> Settings</button>
          <span className="grow" />
          {me.admin && <a className="btn small ghost" href="/admin"><Users size={15} /> Phone admin</a>}
        </nav>

        {tab === "calls" && (
          <section className="list">
            <div className="listhead">
              <label className="toggle"><input type="checkbox" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} /> Missed only</label>
            </div>
            {!shown.length && (
              <div className="empty">
                <PhoneCall size={36} />
                <p>{missedOnly ? "No missed calls." : "Calls you make and take show up here."}</p>
              </div>
            )}
            {shown.map((h) => (
              <div key={h.id} className={`row ${h.missed ? "missed" : ""}`}>
                <span className="avatar">{initials(h.otherName)}</span>
                <div className="grow">
                  <div className="strong">{h.otherName}</div>
                  <div className="muted small rowmeta">
                    {h.missed ? <PhoneMissed size={13} /> : h.direction === "out" ? <PhoneOutgoing size={13} /> : <PhoneIncoming size={13} />}
                    {h.missed ? (h.hasVoicemail ? "Missed, left a voicemail" : "Missed") : h.direction === "out" ? "Outgoing" : "Incoming"}
                    {h.durationS !== null && ` · ${clock(h.durationS)}`}
                    {h.meeting && " · Meet"}
                    {!h.missed && h.durationS === null && h.reason && ` · ${h.reason}`}
                    {h.otherNumber && h.otherName !== h.otherNumber && ` · ${h.otherNumber}`}
                  </div>
                </div>
                <span className="muted small">{when(h.at)}</span>
                <button className="iconbtn" title="Call back" aria-label={`Call ${h.otherName}`} disabled={Boolean(call) || !h.other} onClick={() => void startCall(h.other, h.otherName)}>
                  <Phone size={17} />
                </button>
                {h.other.includes("@") && <a className="iconbtn" title="Chat" aria-label={`Chat with ${h.otherName}`} href={chatLink(h.other)} target="_blank" rel="noreferrer"><MessageIcon /></a>}
                <button className="iconbtn" title="Remove from history" aria-label="Remove from history" onClick={() => {
                  setHistory((list) => list.filter((x) => x.id !== h.id));
                  void api(`/api/calls/${h.id}/hide`, { method: "POST" }).catch(flash);
                }}><X size={16} /></button>
              </div>
            ))}
          </section>
        )}

        {tab === "voicemail" && (
          <section className="list">
            {!voicemail.length && (
              <div className="empty">
                <VoicemailIcon size={36} />
                <p>No voicemail. When you miss a call, the caller can leave you a message here.</p>
              </div>
            )}
            {voicemail.map((v) => (
              <VoicemailRow
                key={v.id}
                v={v}
                onHeard={() => {
                  setVoicemail((list) => list.map((x) => (x.id === v.id ? { ...x, heard: true } : x)));
                  void api(`/api/voicemail/${v.id}`, { method: "PATCH", json: { heard: true } }).catch(() => {});
                }}
                onDelete={() => {
                  setVoicemail((list) => list.filter((x) => x.id !== v.id));
                  void api(`/api/voicemail/${v.id}`, { method: "DELETE" }).catch(flash);
                }}
                onCall={() => void startCall(v.from, v.fromName)}
                canCall={!call && Boolean(v.from)}
              />
            ))}
          </section>
        )}

        {tab === "settings" && <SettingsPane me={me} onSaved={(s) => setMe((m) => ({ ...m, settings: s }))} onError={flash} />}
      </main>

      {call && (
        <CallBar
          call={call}
          canCallOut={me.canCallOut}
          onMute={() => void mute(!call.muted)}
          onHold={() => void hold(!call.held)}
          onKey={(k) => void dtmf(k)}
          onHangup={() => void hangup(call)}
          onAdd={(to) => api(`/api/calls/${call.callId}/add`, { method: "POST", json: { to } }).then(() => true, (e) => (flash(e), false))}
          onTransfer={(to) => api(`/api/calls/${call.callId}/transfer`, { method: "POST", json: { to } }).then(() => {
            leave();
            void reload();
            return true;
          }, (e) => (flash(e), false))}
          onMeet={() => api<{ url: string }>(`/api/calls/${call.callId}/meet`, { method: "POST" }).then((r) => window.open(r.url, "_blank"), flash)}
        />
      )}

      {rings.length > 0 && (
        <div className="rings" role="alert">
          {rings.map((r) => (
            <div key={r.id} className="ring">
              <span className="avatar big pulse">{initials(r.fromName)}</span>
              <div className="grow">
                <div className="strong">{r.fromName}</div>
                <div className="muted small">
                  {r.via ? `Put through by ${r.via}` : r.direction === "inbound" ? `Calling ${r.toNumber ?? "you"}` : "Calling you"}
                  {r.fromNumber && r.fromName !== r.fromNumber && ` · ${r.fromNumber}`}
                </div>
              </div>
              <button className="roundbtn decline" title="Decline" aria-label="Decline" onClick={() => void declineRing(r)}><PhoneOff size={20} /></button>
              <button className="roundbtn accept" title="Answer" aria-label="Answer" onClick={() => void answer(r)}><Phone size={20} /></button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="toast" role="status">{error}</div>}
    </div>
  );
}

function chatLink(email: string): string {
  const host = typeof location !== "undefined" ? location.hostname.replace(/^[^.]+/, "chat") : "";
  return `${location.protocol}//${host}/?dm=${encodeURIComponent(email)}`;
}

function MessageIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const KEYS: [string, string][] = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]];

function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="keypad">
      {KEYS.map(([k, sub]) => (
        <button key={k} type="button" onClick={() => onKey(k)} onContextMenu={(e) => {
          if (k === "0") {
            e.preventDefault();
            onKey("+");
          }
        }}>
          <span className="key">{k}</span>
          <span className="sub">{sub}</span>
        </button>
      ))}
    </div>
  );
}

function VoicemailRow({ v, onHeard, onDelete, onCall, canCall }: { v: Voicemail; onHeard: () => void; onDelete: () => void; onCall: () => void; canCall: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`row vm ${v.heard ? "" : "unheard"}`}>
      <span className="avatar">{initials(v.fromName)}</span>
      <div className="grow">
        <div className="strong">{v.fromName}</div>
        <div className="muted small rowmeta"><VoicemailIcon size={13} /> {clock(v.durationMs / 1000)} · {when(v.at)}{v.fromNumber && v.fromName !== v.fromNumber ? ` · ${v.fromNumber}` : ""}</div>
        {v.transcript ? <p className="transcript">{v.transcript}</p> : v.transcriptError ? <p className="muted small">No transcript: {v.transcriptError}</p> : null}
        {open && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio controls autoPlay src={`/api/voicemail/${v.id}/audio`} onPlay={onHeard} />
        )}
      </div>
      <button className="iconbtn" title="Play" aria-label="Play" onClick={() => setOpen(true)}><Play size={17} /></button>
      <button className="iconbtn" title="Call back" aria-label="Call back" disabled={!canCall} onClick={onCall}><Phone size={17} /></button>
      <button className="iconbtn" title="Delete" aria-label="Delete voicemail" onClick={onDelete}><Trash2 size={16} /></button>
    </div>
  );
}

function CallBar(props: {
  call: ActiveCall; canCallOut: boolean; onMute: () => void; onHold: () => void; onKey: (k: string) => void; onHangup: () => void;
  onAdd: (to: string) => Promise<boolean>; onTransfer: (to: string) => Promise<boolean>; onMeet: () => void;
}) {
  const { call } = props;
  const [now, setNow] = useState(Date.now());
  const [panel, setPanel] = useState<"" | "keys" | "add" | "transfer">("");
  const [to, setTo] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const s = to.trim();
    if (!s || looksLikeNumber(s)) return setFound([]);
    const t = setTimeout(() => api<Person[]>(`/api/directory?q=${encodeURIComponent(s)}`).then(setFound, () => setFound([])), 150);
    return () => clearTimeout(t);
  }, [to]);

  const status = useMemo(() => {
    if (call.state === "connecting") return "Connecting…";
    if (call.state === "ringing") return call.detail || (call.direction === "outbound" ? "Calling…" : "Ringing…");
    if (call.state === "voicemail") return call.detail || "Leave a message after the tone";
    if (call.state === "moved") return "Continued in Meet";
    if (call.state === "ended") return call.detail || "Call ended";
    if (call.held) return "On hold";
    if (call.heldBy) return `${call.heldBy} put you on hold`;
    return call.answeredAt ? clock((now - call.answeredAt) / 1000) : "Connected";
  }, [call, now]);

  const live = call.state === "active";
  const others = call.people.filter((p) => p.name !== call.title);

  async function go(kind: "add" | "transfer", target: string) {
    if (!target.trim()) return;
    const ok = await (kind === "add" ? props.onAdd(target) : props.onTransfer(target));
    if (ok) {
      setTo("");
      setPanel("");
    }
  }

  return (
    <div className={`callbar ${call.state}`} role="region" aria-label="Current call">
      <div className="callwho">
        <span className="avatar big">{initials(call.title)}</span>
        <div className="grow">
          <div className="strong">{call.title}{others.length > 0 && <span className="muted"> and {others.map((o) => o.name).join(", ")}</span>}</div>
          <div className="small callstatus" aria-live="polite">{status}</div>
        </div>
      </div>
      {call.meetUrl && <a className="btn small" href={call.meetUrl} target="_blank" rel="noreferrer"><Video size={15} /> Join in Meet</a>}
      <div className="callctl">
        <button className={`ctl ${call.muted ? "on" : ""}`} onClick={props.onMute} disabled={call.state === "ended" || call.held} aria-pressed={call.muted} title={call.muted ? "Unmute" : "Mute"}>
          {call.muted ? <MicOff size={19} /> : <Mic size={19} />}<span>{call.muted ? "Unmute" : "Mute"}</span>
        </button>
        <button className={`ctl ${call.held ? "on" : ""}`} onClick={props.onHold} disabled={!live} aria-pressed={call.held} title="Hold">
          <Pause size={19} /><span>{call.held ? "Resume" : "Hold"}</span>
        </button>
        <button className={`ctl ${panel === "keys" ? "on" : ""}`} onClick={() => setPanel(panel === "keys" ? "" : "keys")} disabled={call.state === "ended"} title="Keypad">
          <Grid3x3 size={19} /><span>Keypad</span>
        </button>
        <button className={`ctl ${panel === "add" ? "on" : ""}`} onClick={() => setPanel(panel === "add" ? "" : "add")} disabled={!live} title="Add people">
          <UserPlus size={19} /><span>Add</span>
        </button>
        <button className={`ctl ${panel === "transfer" ? "on" : ""}`} onClick={() => setPanel(panel === "transfer" ? "" : "transfer")} disabled={!live} title="Transfer">
          <ArrowRightLeft size={19} /><span>Transfer</span>
        </button>
        <button className="ctl" onClick={props.onMeet} disabled={!live || Boolean(call.meetUrl)} title="Open as a meeting with video">
          <Video size={19} /><span>Meet</span>
        </button>
        <button className="ctl hang" onClick={props.onHangup} disabled={call.state === "ended" || call.state === "moved"} title="Hang up">
          <PhoneOff size={19} /><span>Hang up</span>
        </button>
      </div>
      {panel === "keys" && <Keypad onKey={props.onKey} />}
      {(panel === "add" || panel === "transfer") && (
        <form className="addform" onSubmit={(e) => {
          e.preventDefault();
          void go(panel, found.length === 1 ? found[0].email : to);
        }}>
          <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder={props.canCallOut ? "Name, email or phone number" : "Name or email"} aria-label={panel === "add" ? "Who to add" : "Who to transfer to"} />
          <button className="btn primary small" disabled={!to.trim()}>{panel === "add" ? "Call them in" : "Transfer"}</button>
          {found.length > 0 && (
            <div className="suggestions up">
              {found.map((p) => (
                <button type="button" key={p.email} onClick={() => void go(panel, p.email)}>
                  <span className="avatar">{initials(p.name)}</span>
                  <span className="grow"><span className="strong">{p.name}</span><span className="muted small">{p.numberLabel || p.email}</span></span>
                </button>
              ))}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
