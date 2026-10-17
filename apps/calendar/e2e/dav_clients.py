"""Phone sync end to end with real client libraries: python-caldav for Calendar and vdirsyncer
(with vobject) for Contacts, against running Calendar, Contacts and Account services.

Each client finds the account from the server name alone, makes something, the web app sees it,
the web app changes it, the client syncs the change back, and a delete on the client removes it.

Setup (a virtualenv anywhere):
  python3 -m venv venv && venv/bin/pip install caldav vobject vdirsyncer
Run, with an app password made on the Account page for USER_EMAIL:
  CALENDAR_URL=http://127.0.0.1:3131 CONTACTS_URL=http://127.0.0.1:3192 USER_EMAIL=you@example.com \
  APP_PASSWORD=xxxx-xxxx-xxxx-xxxx PROXY_SECRET=... venv/bin/python apps/calendar/e2e/dav_clients.py
The web app is called the way the gateway would call it (x-auth-request-email and the proxy secret).
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone

import caldav
import vobject

CAL = os.environ.get("CALENDAR_URL", "http://127.0.0.1:3131").rstrip("/")
CON = os.environ.get("CONTACTS_URL", "http://127.0.0.1:3192").rstrip("/")
USER = os.environ["USER_EMAIL"]
PASSWORD = os.environ["APP_PASSWORD"]
SECRET = os.environ.get("PROXY_SECRET", "")
VDIRSYNCER = os.environ.get("VDIRSYNCER", str(pathlib.Path(sys.executable).with_name("vdirsyncer")))


def step(msg):
    print(f"- {msg}", flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def http(method, url, body=None, headers=None, follow=True):
    h = {"x-auth-request-email": USER, "x-proxy-auth-secret": SECRET, **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    if data:
        h["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req) as r:
            return r.status, r.headers, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode()


def web(method, url, body=None):
    status, _, text = http(method, url, body)
    assert status < 300, f"{method} {url}: {status} {text}"
    return json.loads(text) if text else None


def calendar():
    status, headers, _ = http("PROPFIND", CAL + "/.well-known/caldav", follow=False)
    assert status == 301 and headers["location"].endswith("/dav/"), (status, dict(headers))

    step("CalDAV: discovery from the server name")
    client = caldav.DAVClient(url=CAL + "/", username=USER, password=PASSWORD)
    principal = client.principal()
    cals = {c.get_display_name(): c for c in principal.calendars()}
    assert {"Calendar", "Company", "Invitations"} <= set(cals), cals
    cal = cals["Calendar"]
    token = cal.objects_by_sync_token(load_objects=False).sync_token

    step("CalDAV: the client makes a weekly series across the November clock change")
    cal.save_event("\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//e2e//dav_clients//EN",
        "BEGIN:VEVENT", "UID:e2e-standup", f"DTSTAMP:{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}",
        "DTSTART;TZID=America/New_York:20261026T090000", "DTEND;TZID=America/New_York:20261026T093000",
        "SUMMARY:Standup", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT5M", "DESCRIPTION:Standup", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR", ""]))
    events = web("GET", f"{CAL}/api/events?from=2026-10-20T00:00:00Z&to=2026-11-30T00:00:00Z")
    got = [(e["title"], e["start_at"]) for e in events if e["title"].startswith("Standup")]
    assert got == [("Standup", "2026-10-26T13:00:00.000Z"), ("Standup", "2026-11-02T14:00:00.000Z"),
                   ("Standup", "2026-11-09T14:00:00.000Z"), ("Standup", "2026-11-16T14:00:00.000Z")], got
    step("  the web app shows 4 occurrences, 9:00 New York time on both sides of the change")

    step("CalDAV: time-range search finds the series by a later occurrence")
    found = cal.search(start=datetime(2026, 11, 16, tzinfo=timezone.utc), end=datetime(2026, 11, 17, tzinfo=timezone.utc), event=True)
    assert [str(e.icalendar_component["UID"]) for e in found] == ["e2e-standup"], found

    step("the web app renames the series and moves one occurrence; the client syncs both back")
    first = events[0]
    web("PATCH", f"{CAL}/api/events/{first['id']}", {"scope": "all", "title": "Daily standup"})
    second = web("GET", f"{CAL}/api/events?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z")[0]
    web("PATCH", f"{CAL}/api/events/{second['id']}", {"scope": "this", "occurrence": second["occurrence"],
                                                      "startAt": "2026-11-02T16:00:00Z", "endAt": "2026-11-02T16:30:00Z"})
    changed = cal.objects_by_sync_token(sync_token=token, load_objects=True)
    assert len(list(changed)) == 1
    token = changed.sync_token
    ev = cal.event_by_uid("e2e-standup")
    comps = list(ev.icalendar_instance.walk("VEVENT"))
    assert [str(c["SUMMARY"]) for c in comps] == ["Daily standup", "Daily standup"], comps
    assert any("RECURRENCE-ID" in c for c in comps)
    assert "TRIGGER:-PT5M" in ev.data, "the alarm made on the phone is kept"

    step("CalDAV: the client edits the series (If-Match) and the web app sees it")
    master = next(c for c in ev.icalendar_instance.walk("VEVENT") if "RECURRENCE-ID" not in c)
    master["SUMMARY"] = "Team standup"
    ev.save()
    titles = [e["title"] for e in web("GET", f"{CAL}/api/events?from=2026-10-20T00:00:00Z&to=2026-11-30T00:00:00Z")]
    assert titles.count("Team standup") == 3 and "Daily standup" in titles, titles

    step("CalDAV: a delete on the client removes the whole series from the web app")
    ev.delete()
    assert web("GET", f"{CAL}/api/events?from=2026-10-20T00:00:00Z&to=2026-11-30T00:00:00Z") == []
    changed = cal.objects_by_sync_token(sync_token=token, load_objects=False)
    assert changed.sync_token != token


def contacts():
    status, headers, _ = http("PROPFIND", CON + "/.well-known/carddav", follow=False)
    assert status == 301 and headers["location"].endswith("/dav/"), (status, dict(headers))
    work = pathlib.Path(tempfile.mkdtemp(prefix="dav-e2e-"))
    local = work / "local"
    local.mkdir()
    (work / "config").write_text(f"""
[general]
status_path = "{work}/status/"

[pair contacts]
a = "local"
b = "server"
collections = ["from b"]
conflict_resolution = "b wins"

[storage local]
type = "filesystem"
path = "{local}/"
fileext = ".vcf"

[storage server]
type = "carddav"
url = "{CON}/"
username = "{USER}"
password = "{PASSWORD}"
""")
    env = {**os.environ, "VDIRSYNCER_CONFIG": str(work / "config")}

    def run(*args):
        r = subprocess.run([VDIRSYNCER, *args], env=env, capture_output=True, text=True, input="y\n" * 5)
        assert r.returncode == 0, r.stdout + r.stderr
        return r.stdout + r.stderr

    step("CardDAV: vdirsyncer discovers the address book from the server name")
    run("discover", "contacts")
    book = local / "contacts"
    assert book.is_dir(), list(local.iterdir())
    run("sync")

    step("CardDAV: a card made on the client shows in the web app")
    card = vobject.vCard()
    card.add("uid").value = "e2e-card-1"
    card.add("fn").value = "Katherine Johnson"
    card.add("n").value = vobject.vcard.Name(family="Johnson", given="Katherine")
    email = card.add("email")
    email.value = "katherine@example.com"
    email.type_param = "WORK"
    card.add("tel").value = "+1 555 0199"
    card.add("x-custom-field").value = "kept as is"
    (book / "e2e-card-1.vcf").write_text(card.serialize())
    # A second card: vdirsyncer refuses to sync an address book that was emptied completely.
    other = vobject.vCard()
    other.add("uid").value = "e2e-card-2"
    other.add("fn").value = "Dorothy Vaughan"
    other.add("n").value = vobject.vcard.Name(family="Vaughan", given="Dorothy")
    (book / "e2e-card-2.vcf").write_text(other.serialize())
    run("sync")
    people = web("GET", f"{CON}/api/contacts?q=johnson")
    assert [p["displayName"] for p in people] == ["Katherine Johnson"], people
    pid = people[0]["id"]

    step("the web app edits the card; the client syncs it back with what it doesn't model kept")
    p = people[0]
    web("PATCH", f"{CON}/api/contacts/{pid}", {**{k: p[k] for k in ("firstName", "lastName", "emails", "phones")}, "jobTitle": "Mathematician"})
    run("sync")
    back = vobject.readOne((book / "e2e-card-1.vcf").read_text())
    assert back.title.value == "Mathematician", back.serialize()
    assert back.x_custom_field.value == "kept as is"

    step("CardDAV: a delete on the client removes the contact from the web app")
    (book / "e2e-card-1.vcf").unlink()
    run("sync")
    people = web("GET", f"{CON}/api/contacts?q=johnson")
    assert people == [], people
    left = web("GET", f"{CON}/api/contacts?q=vaughan")
    assert len(left) == 1
    web("DELETE", f"{CON}/api/contacts/{left[0]['id']}")


if __name__ == "__main__":
    calendar()
    contacts()
    print("ok")
