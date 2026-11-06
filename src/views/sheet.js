import { api } from "../data/index.js";
import { KINDS, $, $$, busy, esc, icon, initials, playersOf, samePerson, staffInfo, toast, waLink, waNumber } from "../ui.js";
import { addDays, at, dayTitle, hhmm, local, toMin, weeksBetween } from "../time.js";
import { andList, confirmText, courtNames, courtsPhrase, firstName, playerText, weekdays } from "../mensajes.js";

export { confirmText };

const DURS = [30, 60, 90, 120, 150, 180];
const PER_COURT = 4; // jugadores por pista: 8 con 2 pistas, 12 con 3
const NOT_SAVED = "Reserva guardada, pero sin los jugadores: falta activarlos en la base de datos (lo hace Jordi).";
const clean = (list) => list.map(({ name, phone, player_id }) => ({ name, phone: phone || null, player_id: player_id || null }));
/* *negrita* de WhatsApp → <strong> (para enseñar cómo queda el mensaje). */
const waBold = (html) => html.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");

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
        return { court: booking.court_id, day: a.day, start: a.min, dur: z.min - a.min, kind: booking.kind, name: booking.name ?? "", phone: booking.phone ?? "", notes: booking.notes ?? "", paid: booking.paid, player_id: booking.player_id, players: clean(playersOf(booking)) };
      })()
    : { court, day, start: min, dur: Math.min(s.durations?.partido ?? 90, close - min), kind: "partido", name: "", phone: "", notes: "", paid: false, player_id: null, players: [] };
  let durTouched = editing;
  // Pistas: al crear se marcan una, dos o todas (se guardan todo o nada). Al
  // editar, la reserva es de una pista. Las desactivadas en Ajustes no salen
  // en app.courts, así que no se pueden reservar.
  const multi = !editing && app.courts.length > 1;
  const off = app.offCourts ?? [];
  // ¿Está aplicado supabase/jugadores-reserva.sql? Si no, todo sigue igual,
  // pero la lista de jugadores no se guarda (se avisa).
  const hasPl = app.hasPlayers !== false;
  const plBefore = JSON.stringify(st.players);
  // Al editar: las pistas de la misma reserva (p. ej. Pista 1 y 2), que comparten jugadores.
  let group = editing ? [{ id: booking.id, court_id: booking.court_id }] : [];
  const sent = new Set(); // WhatsApp ya abiertos, por número
  let repaintWa = () => {};
  let afterClose = null;

  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.setAttribute("aria-labelledby", "sheetTitle");
  const startOpts = [];
  for (let m = open; m < close; m += slot) startOpts.push(m);

  const courtField = multi
    ? `
      <div class="field" role="group" aria-labelledby="courtLbl">
        <div class="field-head"><span id="courtLbl">Pistas <small>(una o varias)</small></span><button type="button" class="chip chip-sm" id="allCourts" aria-pressed="false">Todas</button></div>
        <div class="seg seg-multi" id="courtSeg">
          ${app.courts.map((c) => `<label><input type="checkbox" name="courts" value="${c.id}" ${Number(st.court) === c.id ? "checked" : ""} /><span>${icon("check")}${esc(c.name)}</span></label>`).join("")}
        </div>
        ${off.length ? `<p class="small warn">${icon("close")} ${esc(andList(off.map((c) => c.name)))} ${off.length === 1 ? "no está disponible" : "no están disponibles"} (Ajustes).</p>` : ""}
        <div class="repeat" id="multiBox" hidden><p class="small" id="multiInfo"></p></div>
      </div>`
    : `
      <fieldset class="seg" id="courtSeg" aria-label="Pista">
        ${app.courts.map((c) => `<label><input type="radio" name="court" value="${c.id}" ${Number(st.court) === c.id ? "checked" : ""} /><span>${esc(c.name)}</span></label>`).join("")}
      </fieldset>
      ${editing ? `<p class="muted small" id="groupInfo" hidden></p>` : ""}`;

  const playersField = `
      <section class="field players" id="atBox" aria-labelledby="atLbl">
        <div class="field-head"><span id="atLbl">Jugadores <small id="atCount"></small></span><button type="button" class="chip chip-sm" id="atHolder" hidden></button></div>
        <ul class="at-list" id="atList"></ul>
        <div class="at-add">
          <input id="atName" placeholder="Nombre" autocomplete="off" enterkeyhint="done" aria-label="Nombre del jugador" role="combobox" aria-expanded="false" aria-controls="atSuggest" aria-autocomplete="list" />
          <input id="atPhone" type="tel" inputmode="tel" placeholder="Teléfono" autocomplete="off" enterkeyhint="done" aria-label="Teléfono del jugador (opcional)" />
          <button type="button" class="btn at-addbtn" id="atAdd" aria-label="Añadir jugador">${icon("plus")}</button>
        </div>
        <ul class="suggest inline" id="atSuggest" role="listbox" hidden></ul>
        <label class="check" id="atSaveBox" hidden><input type="checkbox" id="atSave" checked /><span>Guardarlo también en Jugadores</span></label>
        <p class="small muted" id="atNote" hidden></p>
        ${editing ? `<a class="btn btn-wa btn-block" id="waAll" target="_blank" rel="noopener" hidden></a>` : ""}
      </section>`;

  dlg.innerHTML = `
  <form class="sheet-in" id="bkForm" novalidate>
    <header class="sheet-head">
      <h2 id="sheetTitle" tabindex="-1" autofocus>${editing ? "Reserva" : "Nueva reserva"}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon("close")}</button>
    </header>
    <div class="sheet-body">
      ${editing ? createdLine(app, booking) : ""}
      ${courtField}
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
        <label for="bkName">Nombre <small>(titular, grupo o motivo)</small></label>
        <input id="bkName" name="name" value="${esc(st.name)}" autocomplete="off" placeholder="Ej. Juan Pérez, Escuela infantil…" role="combobox" aria-expanded="false" aria-controls="suggest" aria-autocomplete="list" />
        <ul class="suggest" id="suggest" role="listbox" hidden></ul>
      </div>
      <label class="field">Teléfono <small>(para el WhatsApp)</small><input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(st.phone)}" placeholder="600 000 000" /></label>
      ${playersField}
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
  const atName = $("#atName", dlg);
  const atPhone = $("#atPhone", dlg);
  const atSug = $("#atSuggest", dlg);
  const courtBoxes = () => $$("input[name=courts]", dlg);
  if (multi && !courtBoxes().some((b) => b.checked)) courtBoxes()[0].checked = true;

  // Pistas que se van a reservar: las marcadas (al crear) o la de la reserva.
  function courtsToBook() {
    if (!multi) return [Number(f.court.value)];
    return courtBoxes().filter((b) => b.checked).map((b) => Number(b.value));
  }
  const val = () => ({
    court: courtsToBook()[0],
    day: f.day.value,
    start: Number(f.start.value),
    dur: st.dur,
    kind: f.kind.value,
    name: f.name.value.trim(),
    phone: f.phone.value.trim(),
  });
  const holder = () => ({ name: f.name.value.trim(), phone: f.phone.value.trim() || null, player_id: st.player_id ?? null });
  // Lo que necesitan los mensajes de WhatsApp de los jugadores.
  function msgCtx() {
    const v = val();
    const courts = editing ? [v.court, ...group.filter((g) => g.id !== booking.id).map((g) => Number(g.court_id))] : courtsToBook();
    const days = editing ? [v.day] : weeks();
    return { kind: v.kind, day: v.day, start: v.start, courts, untilKey: days.length > 1 ? days.at(-1) : null, holder: holder() };
  }
  const maxPl = () => PER_COURT * (editing ? group.length : courtsToBook().length);

  function paintDur() {
    const start = Number(f.start.value);
    if (start + st.dur > close) st.dur = Math.max(slot, close - start);
    $$("[data-dur]", dlg).forEach((b) => {
      const d = Number(b.dataset.dur);
      b.setAttribute("aria-pressed", String(d === st.dur));
      b.disabled = start + d > close;
    });
    $("#endsAt", dlg).textContent = `· termina a las ${hhmm(start + st.dur)}`;
    paintCourts();
    paintRepeat();
    paintWa();
    paintPlayers();
  }
  function weeks() {
    if (!f.repeat?.checked || !f.until?.value || f.until.value < f.day.value) return [f.day.value];
    return weeksBetween(f.day.value, f.until.value);
  }
  function paintCourts() {
    if (!multi) return;
    const ids = courtsToBook();
    const all = ids.length === app.courts.length;
    $("#allCourts", dlg).setAttribute("aria-pressed", String(all));
    $("#multiBox", dlg).hidden = ids.length < 2;
    $("#multiInfo", dlg).textContent = `Misma reserva en ${andList(courtNames(app, ids))}. Si una está ocupada, no se guarda ninguna.`;
    $("[type=submit]", dlg).textContent = ids.length < 2 ? "Reservar" : all ? `Reservar las ${ids.length} pistas` : `Reservar ${ids.length} pistas`;
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
    const label = group.length > 1 ? courtsPhrase(app, msgCtx().courts) : null;
    const href = waLink(v.phone, confirmText(app, { ...v, court_id: v.court, starts_at: at(v.day, v.start), ends_at: at(v.day, v.start + v.dur) }, null, label));
    btn.toggleAttribute("aria-disabled", !href);
    if (href) btn.href = href;
    else btn.removeAttribute("href");
    btn.title = href ? "" : "Añade un teléfono para poder enviar el WhatsApp";
  }

  // ---- Jugadores de la reserva ----
  function paintPlayers() {
    const max = maxPl();
    const n = st.players.length;
    const over = n - max;
    const ctx = msgCtx();
    const h = ctx.holder;
    const count = $("#atCount", dlg);
    count.textContent = `· ${n} de ${max}`;
    count.classList.toggle("due", over > 0);
    // Solo se repinta si cambia algo, y solo entra con animación el recién añadido.
    const html = st.players
      .map((p, i) => atRow(p, { i, wa: editing ? waLink(p.phone, playerText(app, ctx, p)) : null, holder: !!h.name && samePerson(p, h), sent, fresh: i === justAdded }))
      .join("");
    if (html !== listHtml) $("#atList", dlg).innerHTML = listHtml = html;
    justAdded = -1;
    const full = n >= max;
    [atName, atPhone, $("#atAdd", dlg)].forEach((el) => (el.disabled = full));
    atName.placeholder = full ? "Lista completa" : "Nombre";
    if (full) {
      atSug.hidden = true;
      $("#atSaveBox", dlg).hidden = true;
    }
    // Atajo: el titular también juega.
    const chip = $("#atHolder", dlg);
    const canHolder = !full && !!h.name && !!(h.phone || h.player_id || ctx.kind === "partido") && !st.players.some((p) => samePerson(p, h));
    chip.hidden = !canHolder;
    if (canHolder) chip.innerHTML = `${icon("plus")} ${esc(firstName(h.name))} <small>(titular)</small>`;
    const notes = [];
    if (over > 0) notes.push(`<span class="warn">Como mucho ${PER_COURT} por pista: quita ${over}${multi ? " o marca otra pista" : ""}.</span>`);
    else if (!n) notes.push(`Hasta ${PER_COURT} por pista. Al escribir salen los de Jugadores.`);
    if (!hasPl) notes.push("Aún no se guardan en la reserva: falta activarlos en la base de datos (lo hace Jordi). El WhatsApp sí funciona.");
    const note = $("#atNote", dlg);
    note.innerHTML = notes.join(" ");
    note.hidden = !notes.length;
    if (editing) paintWaAll($("#waAll", dlg), st.players.filter((p) => waNumber(p.phone)), (p) => waLink(p.phone, playerText(app, ctx, p)), sent, 2);
  }
  repaintWa = paintPlayers;

  let justAdded = -1;
  let listHtml = null;
  let atFound = [];
  let atPick = null; // el único de Jugadores que coincide con lo escrito
  let atTmr;
  const paintSaveBox = () => ($("#atSaveBox", dlg).hidden = !(atName.value.trim() && atPhone.value.trim() && !atPick));
  function resetAdd() {
    atName.value = "";
    atPhone.value = "";
    delete atPhone.dataset.auto;
    atPick = null;
    atFound = [];
    atSug.hidden = true;
    atName.setAttribute("aria-expanded", "false");
    paintSaveBox();
  }
  function addPlayer(p) {
    if (st.players.length >= maxPl()) {
      toast(`Como mucho ${PER_COURT} jugadores por pista.`, { kind: "error" });
      return false;
    }
    if (st.players.some((x) => samePerson(x, p))) {
      toast(`${p.name} ya está en la lista`);
      resetAdd();
      return false;
    }
    st.players.push(p);
    justAdded = st.players.length - 1;
    resetAdd();
    paintPlayers();
    return true;
  }
  function addTyped() {
    const name = atName.value.trim();
    if (!name) return false;
    if (atPick) return addPlayer({ name: atPick.name, phone: atPick.phone || null, player_id: atPick.id });
    const phone = atPhone.value.trim() || null;
    return addPlayer({ name, phone, player_id: null, save: !!phone && $("#atSave", dlg).checked });
  }
  atName.addEventListener("input", () => {
    if (atPhone.dataset.auto) {
      atPhone.value = "";
      delete atPhone.dataset.auto;
    }
    atPick = null;
    paintSaveBox();
    clearTimeout(atTmr);
    atTmr = setTimeout(async () => {
      const q = atName.value;
      const res = await api.searchPlayers(q).catch(() => []);
      if (q !== atName.value) return;
      atFound = res.filter((p) => !st.players.some((x) => samePerson(x, { name: p.name, phone: p.phone, player_id: p.id })));
      atSug.innerHTML = atFound.map((p, i) => `<li role="option" id="at${i}" data-i="${i}"><strong>${esc(p.name)}</strong><span>${esc(p.phone ?? "")}</span></li>`).join("");
      atSug.hidden = !atFound.length;
      atName.setAttribute("aria-expanded", String(!!atFound.length));
      // Si coincide con uno solo, se rellena su teléfono.
      if (atFound.length === 1 && !atPhone.value) {
        atPick = atFound[0];
        atPhone.value = atPick.phone ?? "";
        atPhone.dataset.auto = "1";
      }
      paintSaveBox();
    }, 160);
  });
  atPhone.addEventListener("input", () => {
    delete atPhone.dataset.auto;
    atPick = null;
    paintSaveBox();
  });
  atSug.addEventListener("pointerdown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault();
    const p = atFound[Number(li.dataset.i)];
    addPlayer({ name: p.name, phone: p.phone || null, player_id: p.id });
  });
  [atName, atPhone].forEach((el) =>
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTyped();
      }
      if (e.key === "Escape" && !atSug.hidden) {
        e.stopPropagation();
        e.preventDefault();
        atSug.hidden = true;
      }
    }),
  );
  atName.addEventListener("blur", () => setTimeout(() => (atSug.hidden = true), 150));
  // El botón + no quita el foco del nombre (en el móvil, el teclado no baja).
  $("#atAdd", dlg).addEventListener("pointerdown", (e) => e.preventDefault());
  $("#atAdd", dlg).addEventListener("click", () => addTyped() || atName.focus());
  $("#atHolder", dlg).addEventListener("click", () => addPlayer({ ...holder() }));

  // Al editar una reserva de varias pistas: buscar las otras de la misma reserva.
  if (editing && booking.group_id && hasPl) {
    api
      .groupOf(booking)
      .then((g) => {
        if (!g?.length || !dlg.isConnected) return;
        group = g.some((x) => x.id === booking.id) ? g : [{ id: booking.id, court_id: booking.court_id }, ...g];
        const el = $("#groupInfo", dlg);
        if (el && group.length > 1) {
          el.hidden = false;
          el.innerHTML = `${icon("users")} Reserva de ${group.length} pistas (${esc(andList(courtNames(app, group.map((x) => x.court_id))))}): los jugadores son los mismos en todas.`;
        }
        paintPlayers();
        paintWa();
      })
      .catch(() => {});
  }

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dismiss();
    const d = e.target.closest("[data-dur]");
    if (d) {
      st.dur = Number(d.dataset.dur);
      durTouched = true;
      paintDur();
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      st.players.splice(Number(del.dataset.del), 1);
      paintPlayers();
    }
    // WhatsApp abierto: se marca como enviado y "Enviar a todos" pasa al siguiente
    // (después de abrir este enlace, no antes).
    const wa = e.target.closest("[data-wa]");
    if (wa?.dataset.wa && wa.hasAttribute("href")) {
      sent.add(wa.dataset.wa);
      setTimeout(() => repaintWa(), 0);
    }
  });
  $("#allCourts", dlg)?.addEventListener("click", () => {
    const boxes = courtBoxes();
    const all = boxes.every((b) => b.checked);
    // "Todas" otra vez = vuelve a la pista del hueco pulsado.
    boxes.forEach((b) => (b.checked = all ? Number(b.value) === Number(st.court) : true));
    if (!boxes.some((b) => b.checked)) boxes[0].checked = true;
    $("#conflicts", dlg).hidden = true;
    paintDur();
  });
  f.addEventListener("change", (e) => {
    // Siempre queda al menos una pista marcada.
    if (e.target.name === "courts" && !courtBoxes().some((b) => b.checked)) e.target.checked = true;
    if (e.target.name === "kind" && !durTouched) st.dur = s.durations?.[e.target.value] ?? st.dur;
    if (e.target.name === "day" && f.until && f.until.value < f.day.value) f.until.value = addDays(f.day.value, 7 * 8);
    $("#conflicts", dlg).hidden = true;
    paintDur();
  });
  f.addEventListener("input", (e) => {
    if (e.target.name === "phone" || e.target.name === "name") {
      paintWa();
      paintPlayers();
    }
  });

  // ---- Autocompletar el titular ----
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
    paintPlayers();
  }

  // ---- Guardar ----
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!f.day.value) return f.day.reportValidity();
    // Un jugador escrito y sin añadir también cuenta.
    if (atName.value.trim() && st.players.length < maxPl()) addTyped();
    const over = st.players.length - maxPl();
    if (over > 0) {
      paintPlayers();
      $("#atBox", dlg).scrollIntoView({ block: "center", behavior: "smooth" });
      return toast(`Sobra${over === 1 ? "" : "n"} ${over} jugador${over === 1 ? "" : "es"}: como mucho ${PER_COURT} por pista.`, { kind: "error" });
    }
    const v = val();
    busy(f.querySelector("[type=submit]"), async () => {
      let player_id = st.player_id;
      if (!player_id && v.name && v.phone) player_id = await api.ensurePlayer({ name: v.name, phone: v.phone });
      st.player_id = player_id ?? null;
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
      return editing ? saveEdit(v, row) : saveNew(v, row);
    });
  });

  // Los jugadores nuevos con "Guardarlo también en Jugadores" pasan a la agenda.
  async function withAgenda(players) {
    const out = [];
    for (const p of players) {
      let id = p.player_id || null;
      if (!id && p.save && p.phone) id = await api.ensurePlayer({ name: p.name, phone: p.phone }).catch(() => null);
      out.push({ name: p.name, phone: p.phone || null, player_id: id });
    }
    return out;
  }

  async function saveEdit(v, row) {
    await api.updateBooking(booking.id, row);
    let warn = "";
    if (JSON.stringify(st.players) !== plBefore) {
      if (!hasPl) warn = NOT_SAVED.replace("Reserva guardada", "Cambios guardados");
      else {
        try {
          await api.saveBookingPlayers(group.map((g) => g.id), { players: await withAgenda(st.players) });
        } catch (err) {
          warn = `Cambios guardados, pero los jugadores no: ${err.message}`;
        }
      }
    }
    dismiss();
    toast(warn || "Cambios guardados", warn ? { kind: "error", ms: 8000 } : {});
    onDone?.(v.day);
  }

  async function saveNew(v, row) {
    // Días (repetir cada semana) × pistas marcadas: todo va en una sola llamada
    // a court_book_many, que crea todo o nada. Cada pista lleva su propia serie,
    // así "cancelar este y los siguientes" sigue siendo por pista.
    const days = weeks();
    const courts = courtsToBook();
    const series = Object.fromEntries(courts.map((c) => [c, days.length > 1 ? crypto.randomUUID() : null]));
    const items = days.flatMap((d) => courts.map((c) => ({ ...row, court_id: c, starts_at: at(d, v.start), ends_at: at(d, v.start + v.dur), series_id: series[c] })));
    const res = await api.bookMany(items);
    if (!res.ok) return showConflicts(res.conflicts, { courts: courts.length, days: days.length });
    // Después, quién juega y el grupo que une las pistas (jugadores-reserva.sql).
    // Si falla, la reserva ya está hecha: se avisa y ya.
    const group_id = courts.length > 1 ? crypto.randomUUID() : null;
    const players = await withAgenda(st.players);
    let warn = "";
    if (!hasPl) warn = players.length ? NOT_SAVED : "";
    else if (players.length || group_id) {
      try {
        await api.saveBookingPlayers(res.ids, { players, group_id });
      } catch (err) {
        if (players.length) warn = `Reserva guardada, pero los jugadores no: ${err.message}`;
      }
    }
    const many = courts.length > 1;
    const msg = items.length === 1 ? "Reserva guardada" : many && days.length === 1 ? `${courts.length} pistas reservadas` : `${items.length} reservas guardadas`;
    if (players.some((p) => waNumber(p.phone))) return showSend({ v, ctx: msgCtx(), players, warn, msg, weeks: days.length });
    dismiss();
    const href = waLink(v.phone, confirmText(app, row, days.length > 1 ? days.at(-1) : null, many ? courtsPhrase(app, courts) : null));
    if (warn) toast(warn, { kind: "error", ms: 8000 });
    toast(msg, href ? { action: "Enviar WhatsApp", href } : {});
    onDone?.(v.day);
  }

  /* Reserva hecha: la hoja pasa a "manda el WhatsApp a cada jugador".
     Un toque por jugador; "Enviar a todos" va abriendo uno detrás de otro. */
  function showSend({ v, ctx, players, warn, msg, weeks: nWeeks }) {
    const h = ctx.holder;
    const recipients = [];
    if (h.name && waNumber(h.phone) && !players.some((p) => samePerson(p, h))) recipients.push(h);
    players.filter((p) => waNumber(p.phone)).forEach((p) => recipients.push(p));
    const noPhone = players.filter((p) => !waNumber(p.phone));
    const link = (p) => waLink(p.phone, playerText(app, ctx, p));
    const sample = recipients.find((p) => !samePerson(p, h)) ?? recipients[0];
    afterClose = () => onDone?.(v.day);
    dlg.innerHTML = `
    <div class="sheet-in">
      <header class="sheet-head">
        <h2 id="sheetTitle" tabindex="-1">${esc(msg)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon("close")}</button>
      </header>
      <div class="sheet-body">
        <p class="done">${icon("check")}<span><strong>${esc(dayTitle(v.day))}</strong>, de ${hhmm(v.start)} a ${hhmm(v.start + v.dur)}<br />${esc(andList(courtNames(app, ctx.courts)))}${nWeeks > 1 ? ` · ${nWeeks} semanas` : ""}</span></p>
        ${warn ? `<p class="small warn">${esc(warn)}</p>` : ""}
        <p class="small muted">Confírmalo a cada uno: se abre WhatsApp con el mensaje escrito y tú le das a enviar.</p>
        <ul class="at-list" id="sendList"></ul>
        ${noPhone.length ? `<p class="small muted">Sin teléfono: ${esc(andList(noPhone.map((p) => p.name)))}.</p>` : ""}
        <div class="wa-preview"><span class="small muted">Mensaje para ${esc(firstName(sample.name) || "el jugador")}:</span><p>${waBold(esc(playerText(app, ctx, sample)))}</p></div>
      </div>
      <footer class="sheet-foot">
        <a class="btn btn-wa btn-block" id="waAll" target="_blank" rel="noopener"></a>
        <button type="button" class="btn btn-block" data-close>Listo</button>
      </footer>
    </div>`;
    repaintWa = () => {
      $("#sendList", dlg).innerHTML = recipients.map((p) => atRow(p, { wa: link(p), holder: samePerson(p, h), sent })).join("");
      paintWaAll($("#waAll", dlg), recipients, link, sent, 1);
    };
    repaintWa();
    $("#sheetTitle", dlg).focus();
  }

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
      <p class="small">${many ? "Cambia la hora o el día, o desmarca las pistas ocupadas." : "Cambia la hora, la pista o la fecha final."}</p>`;
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
      afterClose?.();
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

/* Una fila de la lista de jugadores: iniciales, nombre y teléfono, el botón de
   WhatsApp (si tiene teléfono) y el de quitar (si viene i). */
function atRow(p, { i, wa, holder, sent, fresh }) {
  const k = waNumber(p.phone);
  const done = !!(k && sent.has(k));
  return `<li class="at-row${fresh ? " fresh" : ""}">
    <span class="avatar avatar-sm" aria-hidden="true">${esc(initials(p.name) || "?")}</span>
    <span class="at-main"><strong>${esc(p.name)}</strong><span>${esc(p.phone || "Sin teléfono")}${holder ? " · titular" : ""}</span></span>
    ${wa ? `<a class="btn btn-small btn-wa at-wa${done ? " sent" : ""}" href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(k)}" aria-label="${esc(`${done ? "Enviado. Volver a enviar" : "Enviar WhatsApp"} a ${p.name}`)}">${icon(done ? "check" : "chat")}<span>${done ? "Enviado" : "WhatsApp"}</span></a>` : ""}
    ${i != null ? `<button type="button" class="icon-btn at-del" data-del="${i}" aria-label="${esc(`Quitar a ${p.name}`)}">${icon("close")}</button>` : ""}
  </li>`;
}

/* "Enviar a todos (4)" → "Siguiente: Diego (2 de 4)" → "Enviado a todos". */
function paintWaAll(btn, list, link, sent, minimum) {
  if (!btn) return;
  btn.hidden = list.length < minimum;
  if (btn.hidden) return;
  const pending = list.filter((p) => !sent.has(waNumber(p.phone)));
  if (!pending.length) {
    btn.removeAttribute("href");
    btn.setAttribute("aria-disabled", "");
    delete btn.dataset.wa;
    btn.innerHTML = `${icon("check")} Enviado a todos`;
    return;
  }
  const nx = pending[0];
  const done = list.length - pending.length;
  btn.removeAttribute("aria-disabled");
  btn.href = link(nx);
  btn.dataset.wa = waNumber(nx.phone);
  const who = esc(firstName(nx.name));
  btn.innerHTML = `${icon("chat")} ${list.length === 1 ? `Enviar WhatsApp a ${who}` : done ? `Siguiente: ${who} (${done + 1} de ${list.length})` : `Enviar a todos (${list.length})`}`;
}

/* "Reservada por Mily el 26 oct a las 18:03". */
function createdLine(app, b) {
  const by = staffInfo(app, b.created_by);
  if (!by && !b.created_at) return "";
  const when = b.created_at ? new Date(b.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", " a las") : "";
  return `<p class="created">${by ? `<span class="by" style="--u:${by.color}">${esc(by.initial)}</span>Reservada por ${esc(by.name)}` : "Reservada"}${when ? ` el ${esc(when)}` : ""}</p>`;
}
