import { api } from "../data/index.js";
import { KINDS, $, busy, esc, icon, toast, waLink } from "../ui.js";
import { dayShort, hhmm, local, today } from "../time.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* Agenda de jugadores: buscar, ver su historial, editar y llamar/escribir. */
export async function renderPlayers(view, app, id) {
  document.title = "Jugadores · Reservas Mes Malgrat";
  view.innerHTML = `
  <section class="page" aria-labelledby="plTitle">
    <div class="page-head">
      <h1 class="page-title" id="plTitle">Jugadores</h1>
      <button type="button" class="btn btn-primary btn-small" id="newPlayer">${icon("plus")} Nuevo</button>
    </div>
    <label class="search"><span class="sr">Buscar jugador</span>
      <input type="search" id="plSearch" placeholder="Buscar por nombre o teléfono…" autocomplete="off" />
    </label>
    <p class="muted small" id="plCount"></p>
    <ul class="plist" id="plist"></ul>
  </section>`;

  let all = [];
  const list = $("#plist", view);
  const paint = () => {
    const q = norm($("#plSearch", view).value.trim());
    const shown = q ? all.filter((p) => norm(`${p.name} ${p.phone}`).includes(q)) : all;
    $("#plCount", view).textContent = `${shown.length} de ${all.length} ${all.length === 1 ? "jugador" : "jugadores"}`;
    list.innerHTML = shown.length
      ? shown.map((p) => `<li><button type="button" class="prow" data-id="${p.id}">
          <span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span>
          <span class="prow-main"><strong>${esc(p.name)}</strong><span>${esc(p.phone || "Sin teléfono")}</span></span>
          ${icon("next")}</button></li>`).join("")
      : `<li class="empty">${all.length ? "Nadie coincide con esa búsqueda." : "Aún no hay jugadores. Se guardan solos al reservar con nombre y teléfono, o añádelos con «Nuevo»."}</li>`;
  };
  const load = async () => {
    try {
      all = await api.players();
    } catch (e) {
      toast(e.message, { kind: "error" });
    }
    paint();
  };
  $("#plSearch", view).addEventListener("input", paint);
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) openPlayer(app, all.find((p) => p.id === b.dataset.id), load);
  });
  $("#newPlayer", view).addEventListener("click", () => openPlayer(app, null, load));
  await load();
  if (id) {
    const p = all.find((x) => x.id === id);
    if (p) openPlayer(app, p, load);
  }
}

const initials = (n) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/* Ficha de jugador (misma hoja que las reservas). */
async function openPlayer(app, player, onDone) {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.setAttribute("aria-labelledby", "plSheetTitle");
  dlg.innerHTML = `
  <form class="sheet-in" id="plForm" novalidate>
    <header class="sheet-head">
      <h2 id="plSheetTitle" tabindex="-1" autofocus>${player ? esc(player.name) : "Nuevo jugador"}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon("close")}</button>
    </header>
    <div class="sheet-body">
      <label class="field">Nombre y apellidos<input name="name" required value="${esc(player?.name)}" autocomplete="off" /></label>
      <label class="field">Teléfono<input name="phone" type="tel" inputmode="tel" value="${esc(player?.phone)}" autocomplete="off" /></label>
      <label class="field">Notas<textarea name="notes" rows="2" placeholder="Nivel, mano, con quién suele jugar…">${esc(player?.notes)}</textarea></label>
      ${player ? `
      <div class="row">
        ${player.phone ? `<a class="btn btn-small" href="tel:${esc(player.phone)}">Llamar</a>` : ""}
        ${waLink(player.phone, "") ? `<a class="btn btn-small btn-wa" href="${esc(waLink(player.phone, `Hola ${player.name.split(" ")[0]}, `))}" target="_blank" rel="noopener">${icon("chat")} WhatsApp</a>` : ""}
      </div>
      <div class="history" id="history"><p class="muted small">Cargando reservas…</p></div>` : ""}
    </div>
    <footer class="sheet-foot">
      ${player ? `<button type="button" class="btn btn-ghost-danger" id="delPlayer">Borrar de la agenda</button>` : ""}
      <button class="btn btn-primary btn-block" type="submit">${player ? "Guardar cambios" : "Añadir jugador"}</button>
    </footer>
  </form>`;
  document.body.appendChild(dlg);
  const f = $("#plForm", dlg);
  const dismiss = () => {
    dlg.classList.add("closing");
    setTimeout(() => {
      dlg.close();
      dlg.remove();
    }, 220);
  };
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    dismiss();
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dismiss();
  });
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!f.name.value.trim()) return f.name.reportValidity();
    busy(f.querySelector("[type=submit]"), async () => {
      await api.savePlayer(player?.id ?? null, { name: f.name.value.trim(), phone: f.phone.value.trim() || null, notes: f.notes.value.trim() || null });
      dismiss();
      toast(player ? "Jugador guardado" : "Jugador añadido");
      onDone();
    });
  });
  $("#delPlayer", dlg)?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.sure !== "1") {
      btn.dataset.sure = "1";
      btn.textContent = "Pulsa otra vez para borrar";
      return;
    }
    busy(btn, async () => {
      await api.deletePlayer(player.id);
      dismiss();
      toast("Jugador borrado de la agenda (sus reservas se mantienen)");
      onDone();
    });
  });
  dlg.showModal();

  if (!player) return;
  // Historial: próximas y pasadas, con lo que falta por pagar.
  try {
    const bks = await api.playerBookings(player);
    const now = new Date().toISOString();
    const next = bks.filter((b) => b.starts_at >= now).reverse();
    const past = bks.filter((b) => b.starts_at < now);
    const unpaid = past.filter((b) => !b.paid).length;
    const court = (id) => app.courts.find((c) => c.id === id)?.name ?? `Pista ${id}`;
    const row = (b) => {
      const a = local(b.starts_at), z = local(b.ends_at);
      const k = KINDS[b.kind] ?? KINDS.partido;
      return `<li style="--k:${k.color}"><a href="#/dia/${a.day}"><strong>${esc(dayShort(a.day))}${a.day === today() ? " (hoy)" : ""}</strong>
        <span>${hhmm(a.min)}–${hhmm(z.min)}, ${esc(court(b.court_id))}</span><span class="${b.paid ? "ok" : "due"}">${b.paid ? "Pagado" : "Sin pagar"}</span></a></li>`;
    };
    $("#history", dlg).innerHTML = `
      <p class="history-sum"><strong>${bks.length}</strong> ${bks.length === 1 ? "reserva" : "reservas"}${unpaid ? `, <span class="due">${unpaid} pasada${unpaid === 1 ? "" : "s"} sin pagar</span>` : ""}</p>
      ${next.length ? `<h3>Próximas</h3><ul class="hlist">${next.slice(0, 10).map(row).join("")}</ul>` : ""}
      ${past.length ? `<h3>Anteriores</h3><ul class="hlist">${past.slice(0, 15).map(row).join("")}</ul>` : ""}`;
    dlg.querySelectorAll(".hlist a").forEach((a) => a.addEventListener("click", dismiss));
  } catch (e) {
    $("#history", dlg).innerHTML = `<p class="muted small">${esc(e.message)}</p>`;
  }
}
