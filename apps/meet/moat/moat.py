"""
SynergyMeet "moat" worker — the differentiator that turns a recorded meeting into
durable, actioned artifacts across the rest of the Synergy suite.

Flow (all self-hosted, media never leaves our infra):

  LiveKit egress finishes an MP4  ->  LiveKit fires an `egress_ended` webhook here
     -> extract audio (ffmpeg)
     -> transcribe locally (faster-whisper, CPU int8 — the same engine the mind uses)
     -> summarise + pull action items (the suite's AI model, local by default)
     -> file the recording + transcript + notes into SynergyDrive (host's own tenant)
     -> open a SynergyBoards card per action item

Nothing here is user-facing; it is a headless post-processor. It is deliberately
tolerant: any single downstream (Drive / Boards / LLM) can be down or unconfigured
and the rest still runs, so a recording is never lost.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import time
import traceback
import uuid
from pathlib import Path

import jwt  # PyJWT — verify LiveKit's signed webhook
import requests
from fastapi import FastAPI, Request, HTTPException

# ---------------------------------------------------------------------------------------------
# Config (all via env; every downstream is optional so the worker degrades gracefully)
# ---------------------------------------------------------------------------------------------
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")

RECORDINGS_DIR = Path(os.environ.get("RECORDINGS_DIR", "/out"))
WORK_DIR = Path(os.environ.get("MOAT_WORK_DIR", "/work"))
LOG_PATH = Path(os.environ.get("MOAT_LOG", "/work/moat_log.jsonl"))

WHISPER_MODEL = os.environ.get("MOAT_WHISPER", "base.en")

# Summary model: the suite's bring-your-own AI settings (AI_PROVIDER / AI_BASE_URL / AI_API_KEY /
# AI_MODEL), or MOAT_AI_* to give meetings their own model. Defaults to the bundled local Ollama so
# the whole pipeline stays on-box. AI_PROVIDER: openai (any OpenAI-compatible server), anthropic, ollama.
def _ai(key: str, default: str = "") -> str:
    return os.environ.get(f"MOAT_AI_{key}") or os.environ.get(f"AI_{key}") or default


AI_PROVIDER = _ai("PROVIDER", "ollama").lower()
AI_BASE_URL = _ai("BASE_URL", {
    "ollama": "http://127.0.0.1:11434/v1",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
}.get(AI_PROVIDER, "")).rstrip("/")
AI_API_KEY = _ai("API_KEY")
EXTRACT_MODEL = _ai("MODEL", os.environ.get("MOAT_EXTRACT_MODEL", "qwen2.5:3b-instruct"))


def complete(prompt: str, max_tokens: int = 700) -> str:
    """One prompt in, text out, from whichever model the suite is configured to use."""
    if AI_PROVIDER == "anthropic":
        r = requests.post(f"{AI_BASE_URL}/v1/messages", timeout=300, json={
            "model": EXTRACT_MODEL, "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }, headers={"x-api-key": AI_API_KEY, "anthropic-version": "2023-06-01"})
        r.raise_for_status()
        return "".join(c.get("text", "") for c in r.json().get("content", []) if c.get("type") == "text").strip()
    headers = {"Authorization": f"Bearer {AI_API_KEY}"} if AI_API_KEY else {}
    r = requests.post(f"{AI_BASE_URL}/chat/completions", timeout=300, headers=headers, json={
        "model": EXTRACT_MODEL, "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    })
    r.raise_for_status()
    return (r.json()["choices"][0]["message"].get("content") or "").strip()

# SynergyDrive — token-gated machine ingress (the Drive analog of Boards' /api/mind).
DRIVE_BASE = os.environ.get("MOAT_DRIVE_BASE", "").rstrip("/")           # e.g. https://drive.example.com/machine
DRIVE_MACHINE_TOKEN = os.environ.get("MOAT_DRIVE_MACHINE_TOKEN", "")
# The SSO shim maps an email -> (tenant, user) as uuid5(NAMESPACE, domain|email).
# We replicate that mapping so recordings land in the *host's own* Drive tenant.
DRIVE_UUID_NAMESPACE = os.environ.get("MOAT_DRIVE_UUID_NAMESPACE", "")   # a UUID string; matches the shim
# Fallback identity if we can't attribute a host (e.g. an anonymised room).
DRIVE_FALLBACK_TENANT = os.environ.get("MOAT_DRIVE_TENANT", "")
DRIVE_FALLBACK_USER = os.environ.get("MOAT_DRIVE_USER", "")

# SynergyBoards — public token path (oauth2-proxy skips ^/api/mind).
BOARDS_BASE = os.environ.get("MOAT_BOARDS_BASE", "").rstrip("/")         # e.g. https://boards.example.com
MIND_TOKEN = os.environ.get("MOAT_MIND_TOKEN", "")
BOARDS_BOARD = os.environ.get("MOAT_BOARDS_BOARD", "SynergyMeet")
BOARDS_LIST = os.environ.get("MOAT_BOARDS_LIST", "Action Items")

app = FastAPI(title="SynergyMeet moat worker")
_seen_egress: set[str] = set()   # de-dupe: LiveKit can redeliver an event


# ---------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------
def log(rec: dict) -> None:
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), **rec}
    print(json.dumps(rec), flush=True)
    try:
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass


def drive_identity(email: str | None) -> tuple[str, str] | None:
    """Replicate the SSO shim: tenant = uuid5(ns, domain), user = uuid5(ns, email)."""
    if email and DRIVE_UUID_NAMESPACE:
        try:
            ns = uuid.UUID(DRIVE_UUID_NAMESPACE)
            domain = email.split("@", 1)[1].lower()
            return str(uuid.uuid5(ns, domain)), str(uuid.uuid5(ns, email.lower()))
        except Exception:
            pass
    if DRIVE_FALLBACK_TENANT and DRIVE_FALLBACK_USER:
        return DRIVE_FALLBACK_TENANT, DRIVE_FALLBACK_USER
    return None


def parse_recording_name(path: Path) -> dict:
    """
    Recordings are named `<room>__<hostEmail>__<stamp>.mp4` by the record route so the
    worker can attribute them. Fall back gracefully to just the stem if the pattern
    isn't present (e.g. a manually produced file).
    """
    stem = path.stem
    parts = stem.split("__")
    if len(parts) >= 3:
        room, email, stamp = parts[0], parts[1], "__".join(parts[2:])
        email = email.replace("_at_", "@")  # record route may sanitise '@'
        return {"room": room, "host_email": email if "@" in email else None, "stamp": stamp}
    return {"room": stem, "host_email": None, "stamp": ""}


# ---------------------------------------------------------------------------------------------
# transcription (faster-whisper, matches meet_record.py: base.en / cpu / int8)
# ---------------------------------------------------------------------------------------------
_STT = None
_STT_LOCK = threading.Lock()


def _stt():
    global _STT
    if _STT is None:
        with _STT_LOCK:
            if _STT is None:
                from faster_whisper import WhisperModel
                _STT = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _STT


def transcribe(mp4: Path) -> str:
    """MP4 -> 16kHz mono wav (ffmpeg) -> transcript text."""
    wav = WORK_DIR / (mp4.stem + ".wav")
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp4), "-ac", "1", "-ar", "16000", "-vn", str(wav)],
        check=True, capture_output=True,
    )
    try:
        segs, _info = _stt().transcribe(str(wav), language="en", beam_size=1)
        lines = [s.text.strip() for s in segs if s.text.strip()]
        return "\n".join(lines)
    finally:
        try:
            wav.unlink()
        except Exception:
            pass


# ---------------------------------------------------------------------------------------------
# notes + action items (a fixed 4-section prompt, run on the configured model)
# ---------------------------------------------------------------------------------------------
def notes_from(transcript: str, title: str) -> str:
    p = ("From this meeting transcript, produce EXACTLY these sections:\n"
         "SUMMARY: 3 lines max.\nDECISIONS: bullets (or 'none').\n"
         "ACTION ITEMS: bullets as 'owner - task' (or 'none').\n"
         "FOLLOW-UP EMAIL: a short warm follow-up body (<120 words).\n\n"
         f"Meeting: {title}\n\nTranscript:\n{transcript[:6000]}")
    return complete(p, 700)


_OTHER_HEADERS = ("SUMMARY", "DECISIONS", "FOLLOW-UP", "FOLLOW UP", "FOLLOWUP", "NEXT STEPS")


def _strip_md(s: str) -> str:
    """Drop markdown/bullet decoration so header + bullet matching is robust."""
    return s.strip().lstrip("#*->•· \t").rstrip("*: \t").strip()


def action_items(notes: str) -> list[str]:
    """Pull the ACTION ITEMS bullets out of the notes block (markdown-tolerant)."""
    if not notes:
        return []
    lines = notes.splitlines()
    items: list[str] = []
    in_section = False
    for ln in lines:
        norm = _strip_md(ln).upper()
        if norm.startswith("ACTION ITEM"):
            in_section = True
            # allow "ACTION ITEMS: - foo" on the same line (after the colon)
            tail = ln.split(":", 1)[1].strip() if ":" in ln else ""
            tail = tail.strip("* \t")
            if tail and tail.lower() != "none":
                items.append(tail.lstrip("-*•· ").strip())
            continue
        if in_section:
            # any other known section header ends the block
            if any(norm.startswith(h) for h in _OTHER_HEADERS):
                break
            t = ln.strip()
            if not t:
                continue
            t = t.lstrip("-*•·# ").strip().rstrip()
            if t and t.lower() != "none":
                items.append(t)
    # tidy: drop empties/dupes, cap length
    out, seen = [], set()
    for it in items:
        it = it.strip()
        if it and it.lower() not in seen:
            seen.add(it.lower())
            out.append(it)
    return out[:20]


# ---------------------------------------------------------------------------------------------
# downstreams: SynergyBoards (cards) + SynergyDrive (files)
# ---------------------------------------------------------------------------------------------
def board_card(ref: str, title: str, detail: str) -> dict | None:
    if not (BOARDS_BASE and MIND_TOKEN):
        log({"skip": "boards", "why": "not configured"})
        return None
    try:
        r = requests.post(
            f"{BOARDS_BASE}/api/mind",
            headers={"X-Mind-Token": MIND_TOKEN, "Content-Type": "application/json"},
            json={"action": "file", "board": BOARDS_BOARD, "list": BOARDS_LIST,
                  "ref": ref, "title": title[:180], "detail": detail, "issueType": "task"},
            timeout=30,
        )
        ok = r.status_code in (200, 201)
        log({"boards": "card", "ref": ref, "status": r.status_code, "ok": ok})
        return r.json() if ok else None
    except Exception as e:
        log({"boards_error": str(e), "ref": ref})
        return None


def _drive_headers(tenant: str, user: str) -> dict:
    h = {"X-Tenant-ID": tenant, "X-User-ID": user}
    if DRIVE_MACHINE_TOKEN:
        h["X-Machine-Token"] = DRIVE_MACHINE_TOKEN
    return h


def drive_folder(name: str, tenant: str, user: str) -> str | None:
    r = requests.post(f"{DRIVE_BASE}/folders", headers=_drive_headers(tenant, user),
                      json={"name": name}, timeout=30)
    if r.status_code in (200, 201):
        return r.json().get("id")
    log({"drive_folder_fail": r.status_code, "body": r.text[:200]})
    return None


def drive_upload(path: Path, tenant: str, user: str, folder_id: str | None, description: str) -> bool:
    params = {"description": description}
    if folder_id:
        params["parent_folder_id"] = folder_id
    with open(path, "rb") as fh:
        r = requests.post(f"{DRIVE_BASE}/files/upload", headers=_drive_headers(tenant, user),
                          params=params, files={"file": (path.name, fh)}, timeout=600)
    ok = r.status_code in (200, 201)
    log({"drive_upload": path.name, "status": r.status_code, "ok": ok})
    return ok


def to_drive(mp4: Path, transcript_path: Path, notes_path: Path, meta: dict) -> None:
    if not DRIVE_BASE:
        log({"skip": "drive", "why": "not configured"})
        return
    ident = drive_identity(meta.get("host_email"))
    if not ident:
        log({"skip": "drive", "why": "no identity for host", "host": meta.get("host_email")})
        return
    tenant, user = ident
    folder_name = f"SynergyMeet — {meta.get('room','meeting')} — {meta.get('stamp','')}".strip(" —")
    folder_id = drive_folder(folder_name, tenant, user)
    for p, desc in ((mp4, "Recording"), (transcript_path, "Transcript"), (notes_path, "AI notes")):
        if p and p.exists():
            drive_upload(p, tenant, user, folder_id, desc)


# ---------------------------------------------------------------------------------------------
# the pipeline
# ---------------------------------------------------------------------------------------------
def process(mp4: Path) -> None:
    meta = parse_recording_name(mp4)
    title = meta.get("room") or mp4.stem
    log({"stage": "start", "file": mp4.name, **meta})
    try:
        transcript = transcribe(mp4)
    except Exception as e:
        log({"stage": "transcribe_error", "err": str(e), "trace": traceback.format_exc()[-800:]})
        return
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    tpath = WORK_DIR / (mp4.stem + ".transcript.txt")
    tpath.write_text(transcript or "(no speech captured)", encoding="utf-8")

    notes = ""
    if transcript.strip():
        try:
            notes = notes_from(transcript, title)
        except Exception as e:
            log({"stage": "notes_error", "err": str(e)})
    npath = WORK_DIR / (mp4.stem + ".notes.md")
    npath.write_text(notes or "(no notes)", encoding="utf-8")

    items = action_items(notes)
    log({"stage": "extracted", "segments": len(transcript.splitlines()), "action_items": len(items)})

    base_ref = f"meet:{meta.get('room','')}:{meta.get('stamp','')}"
    for i, it in enumerate(items):
        board_card(f"{base_ref}:{i}", it, f"From meeting **{title}**.\n\nAction item: {it}")

    to_drive(mp4, tpath, npath, meta)
    log({"stage": "done", "file": mp4.name})


def _bg(mp4: Path) -> None:
    threading.Thread(target=process, args=(mp4,), daemon=True).start()


# ---------------------------------------------------------------------------------------------
# webhook receiver
# ---------------------------------------------------------------------------------------------
def _verify_livekit(raw: bytes, auth_header: str | None) -> bool:
    """LiveKit signs the webhook: a JWT whose `sha256` claim is the b64 of SHA256(body)."""
    if not (LIVEKIT_API_KEY and LIVEKIT_API_SECRET):
        return True  # unconfigured -> don't block (loopback-only anyway)
    if not auth_header:
        return False
    try:
        token = auth_header.split(" ", 1)[-1]
        claims = jwt.decode(token, LIVEKIT_API_SECRET, algorithms=["HS256"],
                            options={"verify_aud": False})
        import base64
        want = claims.get("sha256", "")
        got = base64.b64encode(hashlib.sha256(raw).digest()).decode()
        return want == got
    except Exception as e:
        log({"webhook_verify_error": str(e)})
        return False


def _file_results(egress: dict) -> list[dict]:
    if egress.get("fileResults"):
        return egress["fileResults"]
    if egress.get("file"):
        return [egress["file"]]
    return []


@app.post("/webhook")
async def webhook(request: Request):
    raw = await request.body()
    if not _verify_livekit(raw, request.headers.get("authorization")):
        raise HTTPException(status_code=401, detail="bad signature")
    try:
        evt = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="bad json")

    if evt.get("event") != "egress_ended":
        return {"ok": True, "ignored": evt.get("event")}

    egress = evt.get("egressInfo") or {}
    eid = egress.get("egressId") or evt.get("id") or ""
    if eid in _seen_egress:
        return {"ok": True, "dup": True}
    _seen_egress.add(eid)

    for fr in _file_results(egress):
        fname = fr.get("filename") or ""
        # egress writes to /out/<name> inside its container == RECORDINGS_DIR/<name> on host mount
        local = RECORDINGS_DIR / Path(fname).name
        if local.exists():
            log({"webhook": "egress_ended", "file": local.name, "egressId": eid})
            _bg(local)
        else:
            log({"webhook": "file_missing", "expected": str(local), "reported": fname})
    return {"ok": True}


@app.get("/healthz")
def healthz():
    return {"ok": True, "whisper": WHISPER_MODEL,
            "drive": bool(DRIVE_BASE), "boards": bool(BOARDS_BASE and MIND_TOKEN)}


@app.post("/reprocess")
def reprocess(name: str):
    """Manual re-run for a known recording filename (ops convenience; loopback only)."""
    p = RECORDINGS_DIR / Path(name).name
    if not p.exists():
        raise HTTPException(status_code=404, detail="not found")
    _bg(p)
    return {"ok": True, "file": p.name}
