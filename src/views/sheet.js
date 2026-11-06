import { api } from "../data/index.js";
import { KINDS, $, $$, busy, esc, icon, staffInfo, toast, waLink } from "../ui.js";
import { addDays, at, dayKey, dayTitle, hhmm, local, parseDay, toMin, weekday, weeksBetween } from "../time.js";

const DURS = [30, 60, 90, 120, 150, 180];
/* ["Pista 1", "Pista 2", "Pista 3"] → "Pista 1, Pista 2 y Pista 3". */
const andList = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} y ${a.at(-1)}`);
/* "todos los sábados" / "todos los lunes" (sábado y domingo llevan -s). */
const weekdays = (key) => weekday(key).replace(/o$/, "os");

/* Mensaje de confirmación para el jugador (se abre WhatsApp con él escrito).
   courtLabel sustituye al nombre de la pista (p. ej. "las 3 pistas"). */
export function confirmText(app, b, untilKey, courtLabel) {
  const s = app.settings;
  const court = courtLabel ?? app.courts.find((c) => c.id === Number(b.court_id))?.name ?? `Pista ${b.court_id}`;
  const a = local(b.starts_at);
  const z = local(b.ends_at);
  const first = (b.name ?? "").trim().split(/\s+/)[0];
  const when = untilKey
    ? `todos los ${weekdays(a.day)} de ${hhmm(a.min)} a ${hhmm(z.min)}, desde el ${parseDay(a.day).toLocaleDateString("es-ES", { day: "numeric", month: "long" })} hasta el ${parseDay(untilKey).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`
    : `el ${dayTitle(a.day).toLowerCase().replace(",", "")}, de ${hhmm(a.min)} a ${hhmm(z.min)}`;
  return `Hola${first ? ` ${first}` : ""}, te confirmo la reserva en ${s.club_name ?? "Padel Mes Malgrat"}: ${court}, ${when}. ¡Nos vemos en la pista!`;
}

/* Hoja de reserva: nueva (con pista/día/hora del hueco pulsado) o existente. */
export function openSheet(app, { booking, court, day, min }, onDone) {
  const s = app.settings;
  const open = toMin(s.open ?? "07:00");
  const close = toMin(s.close ?? "22:30");
  const slot = Number(s.slot_minutes ?? 30);
  const editing = !!booking;
  const st = editing
    ? (() => {
        const a = local(booking.starts_at);
        const z = local(booking.ends_at);
        return { court: booking.court_id, day: a.day, start: a.min, dur: z.min - a.min, kind: booking.kind, name: booking.name ?? "", phone: booking.phone ?? "", notes: booking.notes ?? "", paid: booking.paid, player_id: booking.player_id };
      })()
    : { court, day, start: min, dur: Math.min(s.durations?.partido ?? 90, close - min), kind: "partido", name: "", phone: "", notes: "", paid: false, player_id: null };
  let durTouched = editing;
  // "Reservar las 3 pistas": solo al crear y si hay más de una pista activa.
  // Las desactivadas en Ajustes no salen en app.courts, así que no se reservan.
  const canAll = !editing && app.courts.length > 1;
  const off = app.offCourts ?? [];
  const allLabel = `Reservar las ${app.courts.length} pistas${off.length ? " disponibles" : ""}`;

  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.setAttribute("aria-labelledby", "sheetTitle");
  const startOpts = [];
  for (let m = open; m < close; m += slot) startOpts.push(m);

  dlg.innerHTML = `
  <form class="sheet-in" id="bkForm" novalidate>
    <header class="sheet-head">
      <h2 id="sheetTitle" tabindex="-1" autofocus>${editing ? "Reserva" : "Nueva reserva"}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon("close")}</button>
    </header>
    <div class="sheet-body">
      ${editing ? createdLine(app, booking) : ""}
      <fieldset class="seg" id="courtSeg" aria-label="Pista">
        ${app.courts.map((c) => `<label><input type="radio" name="court" value="${c.id}" ${Number(st.court) === c.id ? "checked" : ""} /><span>${esc(c.name)}</span></label>`).join("")}
      </fieldset>
      ${canAll ? `
      <label class="switch"><input type="checkbox" name="allCourts" /><span class="switch-ui" aria-hidden="true"></span><span>${esc(allLabel)}</span></label>
      <div class="repeat" id="allBox" hidden>
        <p class="small">Misma reserva en ${esc(andList(app.courts.map((c) => c.name)))}. Si una está ocupada, no se guarda ninguna.</p>
        ${off.length ? `<p class="small warn">${icon("close")} ${esc(andList(off.map((c) => c.name)))} ${off.length === 1 ? "no está disponible" : "no están disponibles"} (Ajustes): no se reserva${off.length === 1 ? "" : "n"}.</p>` : ""}
      </div>` : ""}
      <div class="row2">
        <label class="field">Día<input type="date" name="day" value="${st.day}" required /></label>
        <label class="field">Empieza<select name="start">${startOpts.map((m) => `<option value="${m}" ${m === st.start ? "selected" : ""}>${hhmm(m)}</option>`).join("")}</select></label>
      </div>
      <div class="field" role="group" aria-labelledby="durLbl"><span id="durLbl">Duración <small id="endsAt"></small></span>
        <div class="chips" id="durs">${DURS.map((d) => `<button type="button" class="chip" data-dur="${d}">${d < 60 ? `${d} min` : `${d / 60}`.replace(".5", ",5") + " h"}</button>`).join("")}</div>
      </div>
      <div class="field" role="group" aria-labelledby="kindLbl"><span id="kindLbl">Tipo</span>
        <div class="chips kinds">${Object.entries(KINDS).map(([k, v]) => `<label class="chip kind" style="--k:${v.color}"><input type="radio" name="kind" value="${k}" ${k === st.kind ? "checked" : ""} /><span>${v.label}</span></label>`).join("")}</div>
      </div>
      <div class="field suggest-wrap">
        <label for="bkName">Nombre <small>(jugador, grupo o motivo)</small></label>
        <input id="bkName" name="name" value="${esc(st.name)}" autocomplete="off" placeholder="Ej. Juan Pérez, Escuela infantil…" role="combobox" aria-expanded="false" aria-controls="suggest" aria-autocomplete="list" />
        <ul class="suggest" id="suggest" role="listbox" hidden></ul>
      </div>
      <label class="field">Teléfono <small>(para el WhatsApp)</small><input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(st.phone)}" placeholder="600 000 000" /></label>
      <label class="field">Notas<textarea name="notes" rows="2" placeholder="Cualquier detalle para el club…">${esc(st.notes)}</textarea></label>
      <label class="switch"><input type="checkbox" name="paid" ${st.paid ? "checked" : ""} /><span class="switch-ui" aria-hidden="true"></span><span>Pagado en el club</span></label>
      ${editing ? (booking.series_id ? `<p class="muted small">${icon("repeat")} Forma parte de una reserva que se repite cada semana. Los cambios de aquí solo afectan a este día.</p>` : "") : `
      <label class="switch"><input type="checkbox" name="repeat" /><span class="switch-ui" aria-hidden="true"></span><span>Repetir cada semana</span></label>
      <div class="repeat" id="repeatBox" hidden>
        <label class="field">Hasta el<input type="date" name="until" value="${addDays(st.day, 7 * 8)}" /></label>
        <p class="muted small" id="repeatInfo"></p>
      </div>`}
      <div class="conflicts" id="conflicts" role="alert" hidden></div>
    </div>
    <footer class="sheet-foot">
      ${editing ? `
        <div class="sheet-actions">
          <a class="btn btn-wa" id="waBtn" target="_blank" rel="noopener">${icon("chat")} Enviar confirmación</a>
          <button type="button" class="btn btn-ghost-danger" id="cancelBtn">Cancelar reserva</button>
        </div>
        <div class="cancel-choice" id="cancelChoice" hidden>
          <p>¿Cancelar solo este día o también los siguientes?</p>
          <div class="row"><button type="button" class="btn" data-cancel="one">Solo este día</button><button type="button" class="btn btn-danger" data-cancel="following">Este y los siguientes</button></div>
        </div>` : ""}
      <button class="btn btn-primary btn-block" type="submit">${editing ? "Guardar cambios" : "Reservar"}</button>
    </footer>
  </form>`;
  document.body.appendChild(dlg);
  const f = $("#bkForm", dlg);

  const val = () => ({
    court: Number(f.court.value),
    day: f.day.value,
    start: Number(f.start.value),
    dur: st.dur,
    kind: f.kind.value,
    name: f.name.value.trim(),
    phone: f.phone.value.trim(),
  });

  function paintDur() {
    const start = Number(f.start.value);
    if (start + st.dur > close) st.dur = Math.max(slot, close - start);
    $$("[data-dur]", dlg).forEach((b) => {
      const d = Number(b.dataset.dur);
      b.setAttribute("aria-pressed", String(d === st.dur));
      b.disabled = start + d > close;
    });
    $("#endsAt", dlg).textContent = `· termina a las ${hhmm(start + st.dur)}`;
    paintAll();
    paintRepeat();
    paintWa();
  }
  function weeks() {
    if (!f.repeat?.checked || !f.until?.value || f.until.value < f.day.value) return [f.day.value];
    return weeksBetween(f.day.value, f.until.value);
  }
  // Pistas que se van a reservar: la elegida o todas las activas.
  function courtsToBook() {
    return f.allCourts?.checked ? app.courts.map((c) => c.id) : [Number(f.court.value)];
  }
  function paintAll() {
    if (!f.allCourts) return;
    const on = f.allCourts.checked;
    const seg = $("#courtSeg", dlg);
    seg.disabled = on;
    seg.classList.toggle("all", on);
    $("#allBox", dlg).hidden = !on;
    $("[type=submit]", dlg).textContent = on ? allLabel : "Reservar";
  }
  function paintRepeat() {
    if (!f.repeat) return;
    $("#repeatBox", dlg).hidden = !f.repeat.checked;
    const w = weeks();
    const n = courtsToBook().length;
    $("#repeatInfo", dlg).textContent = f.repeat.checked
      ? `Se crearán ${w.length * n} reservas${n > 1 ? ` (${w.length} semanas × ${n} pistas)` : ""}: todos los ${weekdays(f.day.value)} de ${hhmm(Number(f.start.value))} a ${hhmm(Number(f.start.value) + st.dur)}.`
      : "";
  }
  function paintWa() {
    const btn = $("#waBtn", dlg);
    if (!btn) return;
    const v = val();
    const href = waLink(v.phone, confirmText(app, { ...v, court_id: v.court, starts_at: at(v.day, v.start), ends_at: at(v.day, v.start + v.dur) }));
    btn.toggleAttribute("aria-disabled", !href);
    if (href) btn.href = href;
    else btn.removeAttribute("href");
    btn.title = href ? "" : "Añade un teléfono para poder enviar el WhatsApp";
  }

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dismiss();
    const d = e.target.closest("[data-dur]");
    if (d) {
      st.dur = Number(d.dataset.dur);
      durTouched = true;
      paintDur();
    }
  });
  f.addEventListener("change", (e) => {
    if (e.target.name === "kind" && !durTouched) st.dur = s.durations?.[e.target.value] ?? st.dur;
    if (e.target.name === "day" && f.until && f.until.value < f.day.value) f.until.value = addDays(f.day.value, 7 * 8);
    $("#conflicts", dlg).hidden = true;
    paintDur();
  });
  f.addEventListener("input", (e) => {
    if (e.target.name === "phone" || e.target.name === "name") paintWa();
  });

  // ---- Autocompletar jugador ----
  const list = $("#suggest", dlg);
  let found = [];
  let tmr;
  f.name.addEventListener("input", () => {
    st.player_id = null;
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      found = await api.searchPlayers(f.name.value).catch(() => []);
      list.innerHTML = found.map((p, i) => `<li role="option" id="sg${i}" data-i="${i}"><strong>${esc(p.name)}</strong><span>${esc(p.phone ?? "")}</span></li>`).join("");
      list.hidden = !found.length;
      f.name.setAttribute("aria-expanded", String(!!found.length));
    }, 160);
  });
  list.addEventListener("pointerdown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault();
    pick(found[Number(li.dataset.i)]);
  });
  f.name.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !list.hidden && found[0]) {
      e.preventDefault();
      pick(found[0]);
    }
    if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      list.hidden = true;
    }
  });
  f.name.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
  function pick(p) {
    f.name.value = p.name;
    f.phone.value = p.phone ?? "";
    st.player_id = p.id;
    list.hidden = true;
    f.name.setAttribute("aria-expanded", "false");
    paintWa();
  }

  // ---- Guardar ----
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!f.day.value) return f.day.reportValidity();
    const v = val();
    busy(f.querySelector("[type=submit]"), async () => {
      let player_id = st.player_id;
      if (!player_id && v.name && v.phone) player_id = await api.ensurePlayer({ name: v.name, phone: v.phone });
      const row = {
        court_id: v.court,
        starts_at: at(v.day, v.start),
        ends_at: at(v.day, v.start + v.dur),
        kind: v.kind,
        name: v.name || null,
        phone: v.phone || null,
        notes: f.notes.value.trim() || null,
        paid: f.paid.checked,
        player_id: player_id ?? null,
      };
      if (editing) {
        await api.updateBooking(booking.id, row);
        dismiss();
        toast("Cambios guardados");
        return onDone?.(v.day);
      }
      // Días (repetir cada semana) × pistas (reservar las 3): todo va en una
      // sola llamada a court_book_many, que crea todo o nada. Cada pista lleva
      // su propia serie, así "cancelar este y los siguientes" sigue siendo por pista.
      const days = weeks();
      const courts = courtsToBook();
      const series = Object.fromEntries(courts.map((c) => [c, days.length > 1 ? crypto.randomUUID() : null]));
      const items = days.flatMap((d) => courts.map((c) => ({ ...row, court_id: c, starts_at: at(d, v.start), ends_at: at(d, v.start + v.dur), series_id: series[c] })));
      const res = await api.bookMany(items);
      if (!res.ok) return showConflicts(res.conflicts, { courts: courts.length, days: days.length });
      dismiss();
      const all = courts.length > 1;
      const href = waLink(v.phone, confirmText(app, row, days.length > 1 ? days.at(-1) : null, all ? `las ${courts.length} pistas` : null));
      const msg = items.length === 1 ? "Reserva guardada" : all && days.length === 1 ? `${courts.length} pistas reservadas` : `${items.length} reservas guardadas`;
      toast(msg, href ? { action: "Enviar WhatsApp", href } : {});
      onDone?.(v.day);
    });
  });

  function showConflicts(list, { courts = 1, days = 1 } = {}) {
    const box = $("#conflicts", dlg);
    const name = (c) => app.courts.find((x) => x.id === Number(c.court_id))?.name ?? "";
    const many = courts > 1;
    const title =
      list.length === 1 ? (many && days === 1 ? `${name(list[0])} está ocupada` : "Ese hueco está ocupado")
      : many && days === 1 ? `${list.length} pistas están ocupadas`
      : many ? `${list.length} huecos están ocupados`
      : `${list.length} días están ocupados`;
    box.innerHTML = `<p><strong>${esc(title)}.</strong> No se ha guardado nada.</p>
      <ul>${list.slice(0, 6).map((c) => {
        const a = local(c.with.starts_at);
        const z = local(c.with.ends_at);
        return `<li>${esc(dayTitle(local(c.starts_at).day))}, ${esc(name(c))}: ${esc(c.with.name || KINDS[c.with.kind]?.label)} de ${hhmm(a.min)} a ${hhmm(z.min)}</li>`;
      }).join("")}${list.length > 6 ? `<li>…y ${list.length - 6} más</li>` : ""}</ul>
      <p class="small">${many ? "Cambia la hora o el día, o reserva solo las pistas libres." : "Cambia la hora, la pista o la fecha final."}</p>`;
    box.hidden = false;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---- Cancelar ----
  $("#cancelBtn", dlg)?.addEventListener("click", () => {
    if (booking.series_id) {
      $("#cancelChoice", dlg).hidden = false;
      $(".sheet-actions", dlg).hidden = true;
      return;
    }
    cancel([booking.id]);
  });
  $$("[data-cancel]", dlg).forEach((b) =>
    b.addEventListener("click", async () => {
      const ids = b.dataset.cancel === "one" ? [booking.id] : await api.seriesFrom(booking.series_id, booking.starts_at);
      cancel(ids);
    }),
  );
  function cancel(ids) {
    busy($("#cancelBtn", dlg), async () => {
      await api.cancel(ids);
      dismiss();
      onDone?.(local(booking.starts_at).day);
      toast(ids.length > 1 ? `${ids.length} reservas canceladas` : "Reserva cancelada", {
        action: "Deshacer",
        onAction: async () => {
          try {
            await api.restore(ids);
            toast("Reserva recuperada");
            onDone?.(local(booking.starts_at).day);
          } catch (e) {
            toast(e.message, { kind: "error" });
          }
        },
      });
    });
  }

  function dismiss() {
    dlg.classList.add("closing");
    setTimeout(() => {
      dlg.close();
      dlg.remove();
    }, 220);
  }
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    dismiss();
  });

  paintDur();
  dlg.showModal();
  // Solo en ordenador: en el móvil abrir el teclado taparía la hoja.
  if (!editing && matchMedia("(pointer: fine)").matches) setTimeout(() => f.name.focus(), 60);
}

/* "Reservada por Mily el 26 oct a las 18:03". */
function createdLine(app, b) {
  const by = staffInfo(app, b.created_by);
  if (!by && !b.created_at) return "";
  const when = b.created_at ? new Date(b.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", " a las") : "";
  return `<p class="created">${by ? `<span class="by" style="--u:${by.color}">${esc(by.initial)}</span>Reservada por ${esc(by.name)}` : "Reservada"}${when ? ` el ${esc(when)}` : ""}</p>`;
}
