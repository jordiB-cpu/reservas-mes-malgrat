import { api } from "../data/index.js";
import { KINDS, $, $$, busy, esc, toast } from "../ui.js";
import { hhmm, toMin } from "../time.js";

/* Ajustes: nombre y estado de cada pista, horario y duración por tipo. */
export async function renderSettings(view, app, reload) {
  document.title = "Ajustes · Reservas Mes Malgrat";
  const s = app.settings;
  const courts = await api.allCourts();
  const hours = [];
  for (let m = 5 * 60; m <= 24 * 60; m += 30) hours.push(m);
  const opt = (sel) => (sel = sel === "24:00" ? "00:00" : sel, hours).map((m) => `<option value="${hhmm(m % (24 * 60))}" ${hhmm(m % (24 * 60)) === sel ? "selected" : ""}>${hhmm(m % (24 * 60))}</option>`).join("");

  view.innerHTML = `
  <section class="page narrow" aria-labelledby="setTitle">
    <div class="page-head"><h1 class="page-title" id="setTitle">Ajustes</h1></div>
    <form class="form card" id="setForm" novalidate>
      <h2 class="card-title">Pistas</h2>
      <p class="muted small">Desactiva una pista (por obras, por ejemplo) y deja de salir en la agenda; sus reservas no se borran.</p>
      ${courts.map((c) => `
      <div class="court-row">
        <label class="field">Nombre<input name="court-${c.id}" value="${esc(c.name)}" required /></label>
        <label class="switch"><input type="checkbox" name="active-${c.id}" ${c.active ? "checked" : ""} /><span class="switch-ui" aria-hidden="true"></span><span>Activa</span></label>
      </div>`).join("")}

      <h2 class="card-title">Horario</h2>
      <div class="row2">
        <label class="field">Abre<select name="open">${opt(s.open ?? "07:00")}</select></label>
        <label class="field">Cierra<select name="close">${opt(s.close ?? "22:30")}</select></label>
      </div>

      <h2 class="card-title">Duración habitual de cada tipo</h2>
      <p class="muted small">Es la duración que se pone sola al elegir el tipo en una reserva nueva.</p>
      <div class="dur-grid">
        ${Object.entries(KINDS).map(([k, v]) => `
        <label class="field dur-row" style="--k:${v.color}"><span class="kind-dot">${v.label}</span>
          <select name="dur-${k}">${[30, 60, 90, 120, 150, 180, 240].map((d) => `<option value="${d}" ${Number(s.durations?.[k]) === d ? "selected" : ""}>${d < 60 ? `${d} min` : `${String(d / 60).replace(".5", ",5")} h`}</option>`).join("")}</select>
        </label>`).join("")}
      </div>

      <h2 class="card-title">Mensajes de WhatsApp</h2>
      <label class="field">Nombre del club en la confirmación<input name="club_name" value="${esc(s.club_name ?? "Padel Mes Malgrat")}" /></label>

      <button class="btn btn-primary btn-block" type="submit">Guardar ajustes</button>
    </form>
  </section>`;

  const f = $("#setForm", view);
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (toMin(f.close.value) <= toMin(f.open.value) && f.close.value !== "00:00") {
      return toast("La hora de cierre tiene que ser posterior a la de apertura.", { kind: "error" });
    }
    if (!courts.some((c) => f[`active-${c.id}`].checked)) return toast("Deja al menos una pista activa.", { kind: "error" });
    busy(f.querySelector("[type=submit]"), async () => {
      for (const c of courts) {
        const patch = { name: f[`court-${c.id}`].value.trim() || c.name, active: f[`active-${c.id}`].checked };
        if (patch.name !== c.name || patch.active !== c.active) await api.saveCourt(c.id, patch);
      }
      const durations = Object.fromEntries(Object.keys(KINDS).map((k) => [k, Number(f[`dur-${k}`].value)]));
      await api.saveSettings({ open: f.open.value, close: f.close.value === "00:00" ? "24:00" : f.close.value, durations, club_name: f.club_name.value.trim() || "Padel Mes Malgrat" });
      await reload();
      toast("Ajustes guardados");
    });
  });
}
