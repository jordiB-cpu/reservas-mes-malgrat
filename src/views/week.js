import { api } from "../data/index.js";
import { KINDS, $, esc, icon, toast } from "../ui.js";
import { addDays, at, dayShort, hhmm, local, parseDay, toMin, today } from "../time.js";
import { openSheet } from "./sheet.js";

export const mondayOf = (key) => addDays(key, -((parseDay(key).getDay() + 6) % 7));

/* Semana: en el ordenador, 7 días × pistas en una parrilla; en el móvil,
   la lista de reservas de cada día (con su ocupación). */
export async function renderWeek(view, app, key) {
  const mon = mondayOf(key);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const s = app.settings;
  const open = toMin(s.open ?? "07:00");
  const close = toMin(s.close ?? "22:30");
  const slot = Number(s.slot_minutes ?? 30);
  const rows = Math.round((close - open) / slot);
  const fmt = (k, o) => parseDay(k).toLocaleDateString("es-ES", o);
  const range = `${fmt(mon, { day: "numeric" })}${fmt(mon, { month: "short" }) !== fmt(days[6], { month: "short" }) ? ` ${fmt(mon, { month: "short" }).replace(".", "")}` : ""} – ${fmt(days[6], { day: "numeric", month: "short" }).replace(".", "")}`;
  document.title = `Semana del ${range} · Reservas Mes Malgrat`;

  view.innerHTML = `
  <section class="week" style="--rows:${rows}; --cols:${app.courts.length}" aria-labelledby="weekTitle">
    <div class="dayhead">
      <div class="daynav">
        <a class="icon-btn" href="#/semana/${addDays(mon, -7)}" aria-label="Semana anterior">${icon("back")}</a>
        <h1 class="daytitle"><span id="weekTitle">Semana del ${esc(range)}</span></h1>
        <a class="icon-btn" href="#/semana/${addDays(mon, 7)}" aria-label="Semana siguiente">${icon("next")}</a>
      </div>
      <div class="daytools">
        ${days.includes(today()) ? "" : `<a class="chip" href="#/semana/${today()}">Esta semana</a>`}
        <p class="daysum" id="weekSum" aria-live="polite">Cargando…</p>
      </div>
    </div>
    <div class="wgrid" id="wgrid">
      <div class="wgrid-head">
        <span></span>
        ${days.map((d) => `<a class="wday${d === today() ? " is-today" : ""}" href="#/dia/${d}"><strong>${esc(dayShort(d))}</strong><small>${app.courts.map((c) => esc(c.name.replace(/^Pista\s*/i, "P"))).join(" · ")}</small></a>`).join("")}
      </div>
      <div class="wgrid-body">
        <div class="times" aria-hidden="true">${Array.from({ length: rows }, (_, i) => `<span>${(open + i * slot) % 60 ? "" : hhmm(open + i * slot)}</span>`).join("")}</div>
        ${days.map((d) => `<div class="wcol" data-day="${d}">${app.courts.map((c) => `<div class="wsub" data-court="${c.id}"></div>`).join("")}</div>`).join("")}
      </div>
    </div>
    <div class="agenda" id="agenda"></div>
  </section>`;

  let bookings = [];
  const load = async () => {
    try {
      bookings = await api.bookings(at(mon, 0), at(addDays(mon, 7), 0));
    } catch (e) {
      toast(e.message, { kind: "error" });
    }
    paint();
  };
  const courtName = (id) => app.courts.find((c) => c.id === id)?.name ?? `Pista ${id}`;

  function paint() {
    // Parrilla (ordenador)
    days.forEach((d) => {
      app.courts.forEach((c) => {
        const sub = $(`.wcol[data-day="${d}"] .wsub[data-court="${c.id}"]`, view);
        sub.innerHTML = bookings
          .filter((b) => b.court_id === c.id && local(b.starts_at).day === d)
          .map((b) => {
            const a = local(b.starts_at).min, z = local(b.ends_at).min;
            const from = Math.max(a, open), to = Math.min(z, close);
            const k = KINDS[b.kind] ?? KINDS.partido;
            return `<button type="button" class="wbk" data-id="${b.id}" style="--k:${k.color}; --top:${(from - open) / slot}; --len:${(to - from) / slot}"
              title="${esc(`${courtName(c.id)}, ${hhmm(a)}–${hhmm(z)}: ${b.name || k.label}`)}" aria-label="${esc(`${dayShort(d)}, ${courtName(c.id)}, ${hhmm(a)} a ${hhmm(z)}, ${b.name || k.label}`)}"><span>${esc(b.name || k.label)}</span></button>`;
          })
          .join("");
      });
    });
    // Lista (móvil)
    const total = (close - open) * app.courts.length;
    $("#agenda", view).innerHTML = days.map((d) => {
      const list = bookings.filter((b) => local(b.starts_at).day === d);
      const used = list.reduce((m, b) => m + Math.min(local(b.ends_at).min, close) - Math.max(local(b.starts_at).min, open), 0);
      const pct = Math.round((used / total) * 100);
      return `<article class="aday${d === today() ? " is-today" : ""}">
        <a class="aday-head" href="#/dia/${d}"><strong>${esc(dayShort(d))}</strong><span>${list.length ? `${list.length} ${list.length === 1 ? "reserva" : "reservas"}, ${pct} % ocupado` : "Libre"}</span>${icon("next")}</a>
        <span class="meter" aria-hidden="true"><span style="width:${pct}%"></span></span>
        ${list.length ? `<ul>${list.map((b) => {
          const k = KINDS[b.kind] ?? KINDS.partido;
          return `<li><button type="button" class="arow" data-id="${b.id}" style="--k:${k.color}">
            <span class="arow-time">${hhmm(local(b.starts_at).min)}–${hhmm(local(b.ends_at).min)}</span>
            <span class="arow-name">${esc(b.name || k.label)}</span>
            <span class="arow-court">${esc(courtName(b.court_id))}</span></button></li>`;
        }).join("")}</ul>` : ""}
      </article>`;
    }).join("");
    const unpaid = bookings.filter((b) => !b.paid && ["partido", "clase"].includes(b.kind)).length;
    $("#weekSum", view).textContent = `${bookings.length} ${bookings.length === 1 ? "reserva" : "reservas"}${unpaid ? `, ${unpaid} sin pagar` : ""}`;
  }

  $(".week", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) return openSheet(app, { booking: bookings.find((x) => x.id === b.dataset.id) }, load);
    const sub = e.target.closest(".wsub");
    if (sub && e.target === sub) {
      // Hueco libre: la hora sale de dónde se ha pulsado.
      const r = sub.getBoundingClientRect();
      const m = open + Math.floor(((e.clientY - r.top) / r.height) * rows) * slot;
      openSheet(app, { court: Number(sub.dataset.court), day: sub.closest(".wcol").dataset.day, min: Math.min(m, close - slot) }, load);
    }
  });
  await load();
}
