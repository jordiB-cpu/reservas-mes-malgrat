import { api } from "../data/index.js";
import { KINDS, $, esc, icon, reduced, staffInfo, staffLegend, toast } from "../ui.js";
import { addDays, at, dayShort, dayTitle, hhmm, local, toMin, today } from "../time.js";
import { openSheet } from "./sheet.js";

/* Vista de un día: las pistas en columnas, las horas en filas de 30 min.
   Tocar un hueco libre = nueva reserva; tocar una reserva = verla/editarla. */
export async function renderDay(view, app, key) {
  const s = app.settings;
  const open = toMin(s.open ?? "07:00");
  const close = toMin(s.close ?? "22:30");
  const slot = Number(s.slot_minutes ?? 30);
  const rows = Math.round((close - open) / slot);
  const isToday = key === today();

  view.innerHTML = `
  <section class="day" aria-labelledby="dayTitle" style="--rows:${rows}; --cols:${app.courts.length}">
    <div class="dayhead">
      <div class="daynav">
        <a class="icon-btn" href="#/dia/${addDays(key, -1)}" aria-label="Día anterior" data-dir="-1">${icon("back")}</a>
        <label class="daytitle">
          <span id="dayTitle">${esc(dayTitle(key))}</span>
          <input type="date" id="pickDay" value="${key}" aria-label="Elegir día" />
        </label>
        <a class="icon-btn" href="#/dia/${addDays(key, 1)}" aria-label="Día siguiente" data-dir="1">${icon("next")}</a>
      </div>
      <div class="daytools">
        ${isToday ? "" : `<a class="chip" href="#/dia/${today()}">Hoy</a>`}
        <p class="daysum" id="daySum" aria-live="polite"></p>
        ${staffLegend(app)}
      </div>
        <div class="board-head">
          <span></span>
          ${app.courts.map((c) => `<span class="court-name">${esc(c.name)}</span>`).join("")}
        </div>
      </div>
    <div class="board" id="board">
      <div class="board-body">
        <div class="times" aria-hidden="true">
          ${Array.from({ length: rows }, (_, i) => {
            const m = open + i * slot;
            return `<span class="${m % 60 ? "half" : ""}">${hhmm(m)}</span>`;
          }).join("")}
        </div>
        ${app.courts.map((c) => `
        <div class="col" data-court="${c.id}">
          ${Array.from({ length: rows }, (_, i) => {
            const m = open + i * slot;
            return `<button type="button" class="slot${m % 60 ? " half" : ""}" data-min="${m}" aria-label="Reservar ${esc(c.name)} a las ${hhmm(m)}"></button>`;
          }).join("")}
          <div class="bks" data-bks="${c.id}"></div>
        </div>`).join("")}
        ${isToday ? `<div class="now" id="nowLine" aria-hidden="true"><span></span></div>` : ""}
      </div>
    </div>
    <p class="loading-day" id="dayLoading">Cargando reservas…</p>
  </section>`;
  document.title = `${dayShort(key)} · Reservas Padel Mes Malgrat`;

  const board = $("#board", view);
  let bookings = [];

  async function load() {
    try {
      bookings = await api.bookings(at(key, 0), at(addDays(key, 1), 0));
    } catch (e) {
      toast(e.message, { kind: "error" });
      bookings = [];
    }
    $("#dayLoading", view)?.remove();
    paint();
  }

  function paint() {
    app.courts.forEach((c) => {
      const box = $(`[data-bks="${c.id}"]`, board);
      box.innerHTML = bookings
        .filter((b) => b.court_id === c.id)
        .map((b) => {
          const a = local(b.starts_at);
          const z = local(b.ends_at);
          const from = Math.max(a.day === key ? a.min : 0, open);
          const to = Math.min(z.day === key ? z.min : 24 * 60, close);
          if (to <= from) return "";
          const k = KINDS[b.kind] ?? KINDS.partido;
          const short = to - from <= slot;
          const by = staffInfo(app, b.created_by);
          return `<button type="button" class="bk${short ? " short" : ""}${b.paid ? " paid" : ""}" data-id="${b.id}"
            style="--k:${k.color}; --u:${by?.color ?? k.color}; --top:${(from - open) / slot}; --len:${(to - from) / slot}"
            aria-label="${esc(`${k.label}${b.name ? `, ${b.name}` : ""}, de ${hhmm(a.min)} a ${hhmm(z.min)}${b.paid ? ", pagado" : ""}${by ? `, reservada por ${by.name}` : ""}`)}">
            ${by ? `<span class="by" title="Reservada por ${esc(by.name)}">${esc(by.initial)}</span>` : ""}
            <span class="bk-time">${hhmm(a.min)}–${hhmm(z.min)}</span>
            <span class="bk-name">${esc(b.name || k.label)}</span>
            ${short ? "" : `<span class="bk-meta">${k.label}${b.series_id ? ` ${icon("repeat")}` : ""}${b.paid ? ` ${icon("check")}` : ""}</span>`}
          </button>`;
        })
        .join("");
    });
    const unpaid = bookings.filter((b) => !b.paid && ["partido", "clase"].includes(b.kind)).length;
    $("#daySum", view).textContent = bookings.length
      ? `${bookings.length} ${bookings.length === 1 ? "reserva" : "reservas"}${unpaid ? `, ${unpaid} sin pagar` : ""}`
      : "Sin reservas";
    markBusy();
    paintNow();
  }

  // Huecos ocupados: no se pueden pulsar (se pulsa la reserva).
  function markBusy() {
    app.courts.forEach((c) => {
      const mine = bookings.filter((b) => b.court_id === c.id).map((b) => [local(b.starts_at).min, local(b.ends_at).min]);
      board.querySelectorAll(`[data-court="${c.id}"] .slot`).forEach((el) => {
        const m = Number(el.dataset.min);
        const taken = mine.some(([a, z]) => m < z && m + slot > a);
        el.disabled = taken;
        el.tabIndex = taken ? -1 : 0;
      });
    });
  }

  function paintNow() {
    const line = $("#nowLine", view);
    if (!line) return;
    const d = new Date();
    const m = d.getHours() * 60 + d.getMinutes();
    line.hidden = m < open || m > close;
    line.style.setProperty("--top", (m - open) / slot);
  }
  const nowTimer = isToday ? setInterval(paintNow, 60_000) : null;

  board.addEventListener("click", (e) => {
    const bk = e.target.closest(".bk");
    if (bk) return openSheet(app, { booking: bookings.find((b) => b.id === bk.dataset.id) }, refresh);
    const sl = e.target.closest(".slot");
    if (sl && !sl.disabled) openSheet(app, { court: Number(sl.closest(".col").dataset.court), day: key, min: Number(sl.dataset.min) }, refresh);
  });
  function refresh(dayChanged) {
    if (dayChanged && dayChanged !== key) location.hash = `#/dia/${dayChanged}`;
    else load();
  }

  $("#pickDay", view).addEventListener("change", (e) => e.target.value && (location.hash = `#/dia/${e.target.value}`));

  // Deslizar a los lados en el móvil = cambiar de día.
  let sx = 0, sy = 0;
  board.addEventListener("touchstart", (e) => ([sx, sy] = [e.touches[0].clientX, e.touches[0].clientY]), { passive: true });
  board.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  });
  // Flechas del teclado en el ordenador.
  const onKey = (e) => {
    if (e.target.closest("input, textarea, select, dialog")) return;
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
    if (e.key.toLowerCase() === "h") location.hash = `#/dia/${today()}`;
  };
  document.addEventListener("keydown", onKey);
  function go(dir) {
    view.dataset.dir = dir;
    location.hash = `#/dia/${addDays(key, dir)}`;
  }
  $(".day", view).addEventListener("click", (e) => {
    const a = e.target.closest("[data-dir]");
    if (a) view.dataset.dir = a.dataset.dir;
  });

  // Al abrir hoy, la parrilla empieza cerca de la hora actual.
  if (isToday) {
    const d = new Date();
    const m = d.getHours() * 60 + d.getMinutes() - 60;
    if (m > open) requestAnimationFrame(() => window.scrollTo({ top: board.offsetTop + ((m - open) / slot) * parseFloat(getComputedStyle(board).getPropertyValue("--row") || 44) - 8, behavior: "instant" }));
  }

  await load();
  return () => {
    clearInterval(nowTimer);
    document.removeEventListener("keydown", onKey);
  };
}
