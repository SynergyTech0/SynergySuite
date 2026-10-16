import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type Server = { kind: "domain"; domain: string } | { kind: "local" };
type App = { id: string; name: string; m365: string; port: number };
type State = { server: Server | null; apps: App[]; lastApp: string | null; version: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TILE_COLORS = ["#19c2f0", "#2b4fe0", "#7b3bea", "#0a8fc7", "#4a35d6"];

let state: State;

function describe(server: Server): string {
  return server.kind === "local" ? "This computer" : server.domain;
}

function showConnect(canCancel: boolean) {
  $("launcher").hidden = true;
  $("connect").hidden = false;
  $("connect-cancel").hidden = !canCancel;
  const input = $<HTMLInputElement>("server");
  input.value = state.server ? (state.server.kind === "local" ? "localhost" : state.server.domain) : "";
  input.focus();
  input.select();
}

function showLauncher() {
  $("connect").hidden = true;
  $("launcher").hidden = false;
  $("server-name").textContent = describe(state.server!);
  $("version").textContent = `Synergy desktop ${state.version}`;
  renderApps("");
  $<HTMLInputElement>("filter").focus();
}

function renderApps(filter: string) {
  const q = filter.trim().toLowerCase();
  const list = $("apps");
  list.replaceChildren();
  state.apps
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.m365.toLowerCase().includes(q))
    .forEach((app, i) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "app";
      if (app.id === state.lastApp) button.classList.add("recent");
      const tile = document.createElement("span");
      tile.className = "tile";
      tile.style.background = TILE_COLORS[i % TILE_COLORS.length];
      tile.textContent = app.name[0];
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = app.name;
      button.title = app.name;
      button.append(tile, name);
      button.addEventListener("click", () => openApp(app.id));
      li.append(button);
      list.append(li);
    });
}

let opening = false;

async function openApp(id: string) {
  if (opening) return;
  opening = true;
  try {
    await invoke("open_app", { id });
  } catch (e) {
    opening = false;
    console.error(e);
  }
}

$("connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("connect-error");
  error.textContent = "";
  try {
    state.server = await invoke<Server>("set_server", { input: $<HTMLInputElement>("server").value });
    history.replaceState(null, "", location.pathname);
    showLauncher();
  } catch (err) {
    error.textContent = String(err);
  }
});
$("connect-cancel").addEventListener("click", () => {
  history.replaceState(null, "", location.pathname);
  showLauncher();
});
$("change-server").addEventListener("click", () => showConnect(true));
$("filter").addEventListener("input", (e) => renderApps((e.target as HTMLInputElement).value));
$("filter").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = $("apps").querySelector<HTMLButtonElement>("button");
  first?.click();
});

state = await invoke<State>("get_state");
if (!state.server) showConnect(false);
else if (location.hash === "#connect") showConnect(true);
else showLauncher();
