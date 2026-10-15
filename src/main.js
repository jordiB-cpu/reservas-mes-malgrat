import "@fontsource/anton/latin-400.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./style.css";
import { api } from "./data/index.js";
import { $, esc, icon, reduced, toast } from "./ui.js";
import { today } from "./time.js";
import { renderDay } from "./views/day.js";
import { renderWeek } from "./views/week.js";
import { renderPlayers } from "./views/players.js";
import { renderSettings } from "./views/settings.js";
import { renderLogin, renderNoAccess } from "./views/login.js";

/* Estado: sesión + configuración (pistas y ajustes). */
const app = { session: null, courts: [], settings: {} };
const view = $("#app");
let cleanup = null;
let lastDay = today();

const reloadConfig = async () => Object.assign(app, await api.loadConfig());

async function route() {
  // Una hoja abierta no sobrevive a un cambio de pantalla (p. ej. botón Atrás del móvil).
  document.querySelectorAll("dialog.sheet").forEach((d) => (d.close(), d.remove()));
  document.documentElement.classList.remove("is-locked");
  cleanup?.();
  cleanup = null;
  $("#userBox").innerHTML = "";
  $("#tabs").innerHTML = "";
  if (!app.session) return renderLogin(view);
  if (app.session.profile?.role !== "admin") return renderNoAccess(view, app.session);
  const h = location.hash;
  const day = h.match(/^#\/dia\/(\d{4}-\d{2}-\d{2})$/);
  const week = h.match(/^#\/semana\/(\d{4}-\d{2}-\d{2})$/);
  const players = h.match(/^#\/jugadores(?:\/([\w-]+))?$/);
  const settings = h === "#/ajustes";
  if (!day && !week && !players && !settings) return void (location.hash = `#/dia/${today()}`);
  if (day) lastDay = day[1];
  if (week) lastDay = week[1];
  paintChrome(day ? "dia" : week ? "semana" : players ? "jugadores" : "ajustes");

  const dir = Number(view.dataset.dir || 0);
  delete view.dataset.dir;
  const swap = async () => {
    try {
      if (day) cleanup = await renderDay(view, app, day[1]);
      else if (week) await renderWeek(view, app, week[1]);
      else if (players) await renderPlayers(view, app, players[1]);
      else await renderSettings(view, app, reloadConfig);
    } catch (e) {
      console.error(e);
      view.innerHTML = `<section class="page"><h1 class="page-title">No se ha podido cargar</h1><p class="muted">${esc(e.message)}</p><p><button class="btn btn-primary" type="button" onclick="location.reload()">Volver a intentarlo</button></p></section>`;
    }
  };
  // Cambio de día con transición lateral (si el navegador sabe hacerlas).
  if (dir && document.startViewTransition && !reduced()) {
    document.documentElement.dataset.dir = dir > 0 ? "next" : "prev";
    await document.startViewTransition(swap).finished.catch(() => {});
    delete document.documentElement.dataset.dir;
  } else await swap();
}

function paintChrome(cur) {
  const p = app.session.profile;
  $("#userBox").innerHTML = `<span class="who">${esc((p.full_name || p.email || "").split(/[ @]/)[0])}</span><button type="button" class="btn btn-small btn-dark" id="logout">Salir</button>`;
  $("#logout").addEventListener("click", () => api.signOut());
  const tab = (id, href, ic, label) => `<a href="${href}" ${cur === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`;
  $("#tabs").innerHTML = [
    tab("dia", `#/dia/${lastDay}`, "day", "Día"),
    tab("semana", `#/semana/${lastDay}`, "week", "Semana"),
    tab("jugadores", "#/jugadores", "users", "Jugadores"),
    tab("ajustes", "#/ajustes", "gear", "Ajustes"),
  ].join("");
}

async function boot() {
  try {
    app.session = await api.session();
    if (app.session?.profile?.role === "admin") await reloadConfig();
  } catch (e) {
    toast(e.message, { kind: "error" });
  }
  route();
}

window.addEventListener("hashchange", route);
api.onAuthChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT") boot();
});
$("#demoBanner").hidden = api.mode !== "demo";
boot();

// App instalable: el service worker solo guarda la "carcasa" para abrir rápido.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
