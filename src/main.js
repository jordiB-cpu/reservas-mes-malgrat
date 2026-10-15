import "@fontsource/anton/latin-400.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./style.css";
import { api } from "./data/index.js";
import { $, esc, reduced, toast } from "./ui.js";
import { today } from "./time.js";
import { renderDay } from "./views/day.js";
import { renderLogin, renderNoAccess } from "./views/login.js";

/* Estado: sesión + configuración (pistas y ajustes). */
const app = { session: null, courts: [], settings: {} };
const view = $("#app");
let cleanup = null;

async function route() {
  cleanup?.();
  cleanup = null;
  $("#userBox").innerHTML = "";
  if (!app.session) return renderLogin(view);
  if (app.session.profile?.role !== "admin") return renderNoAccess(view, app.session);
  paintUser();
  const m = location.hash.match(/^#\/dia\/(\d{4}-\d{2}-\d{2})$/);
  if (!m) return void (location.hash = `#/dia/${today()}`);
  const dir = Number(view.dataset.dir || 0);
  delete view.dataset.dir;
  const swap = async () => {
    cleanup = await renderDay(view, app, m[1]);
  };
  // Cambio de día con transición lateral (si el navegador sabe hacerlas).
  if (dir && document.startViewTransition && !reduced()) {
    document.documentElement.dataset.dir = dir > 0 ? "next" : "prev";
    await document.startViewTransition(swap).finished.catch(() => {});
    delete document.documentElement.dataset.dir;
  } else await swap();
}

function paintUser() {
  const p = app.session.profile;
  $("#userBox").innerHTML = `<span class="who">${esc((p.full_name || p.email || "").split(/[ @]/)[0])}</span><button type="button" class="btn btn-small btn-dark" id="logout">Salir</button>`;
  $("#logout").addEventListener("click", () => api.signOut());
}

async function boot() {
  try {
    app.session = await api.session();
    if (app.session?.profile?.role === "admin") Object.assign(app, await api.loadConfig());
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
