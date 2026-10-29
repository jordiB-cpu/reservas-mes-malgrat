// Página pública del bono de un alumno: /bono/?c=<código>
// Sin cuenta: lee su foto con pass_view (supabase/bonos.sql). Las clases
// previstas se dan por hechas solas en cuanto acaba su hora.
import "@fontsource/anton/latin-400.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-700.css";
import "./bono.css";
import { esc } from "./ui.js";

const URL_SB = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ZONA = "Europe/Madrid";
const $bono = document.getElementById("bono");

const fecha = (iso, opts) => new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, ...opts }).format(new Date(iso));
const corta = (iso) => fecha(iso, { day: "2-digit", month: "2-digit" });
const larga = (iso) => fecha(iso, { weekday: "long", day: "numeric", month: "long" });
const hora = (iso) => fecha(iso, { hour: "2-digit", minute: "2-digit" });
const euros = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;

async function cargar(token) {
  if (URL_SB && KEY) {
    const r = await fetch(`${URL_SB}/rest/v1/rpc/pass_view`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  // Sin Supabase (modo demo): un bono de ejemplo para ver la página.
  const h = (dias, hh) => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(hh, 0, 0, 0); return d; };
  const s = (dias, hh) => ({ inicio: h(dias, hh).toISOString(), fin: h(dias, hh + 1).toISOString() });
  return { nombre: "Thais", actualizado: new Date().toISOString(), bonos: [{ tipo: "Bono 4 clases compartido", precio: 65, tarifa: "general", clases: 4, antes: 0, sesiones: [s(-7, 19), s(-2, 19), s(0, 19)] }] };
}

// Estado de un bono ahora mismo.
function estado(b, ahora) {
  const hechas = b.sesiones.filter((s) => new Date(s.fin) <= ahora);
  const futuras = b.sesiones.filter((s) => new Date(s.fin) > ahora);
  const usadas = b.antes + hechas.length;
  return { hechas, futuras, usadas, quedan: Math.max(0, b.clases - usadas) };
}

function casillas(b, e) {
  const out = [];
  for (let i = 0; i < b.clases; i++) {
    if (i < b.antes) out.push(`<li class="casilla hecha"><span class="marca" aria-hidden="true">✕</span><span class="dia">hecha</span></li>`);
    else if (i < e.usadas) {
      const s = e.hechas[i - b.antes];
      out.push(`<li class="casilla hecha"><span class="marca" aria-hidden="true">✕</span><span class="dia">${corta(s.inicio)}</span></li>`);
    } else {
      const s = e.futuras[i - e.usadas];
      out.push(s
        ? `<li class="casilla prevista"><span class="marca" aria-hidden="true">${hora(s.inicio)}</span><span class="dia">${corta(s.inicio)}</span></li>`
        : `<li class="casilla libre"><span class="marca" aria-hidden="true"></span><span class="dia">libre</span></li>`);
    }
  }
  return `<ol class="casillas c${b.clases}" aria-label="${plural(e.usadas, "clase hecha", "clases hechas")} de ${b.clases}">${out.join("")}</ol>`;
}

function pintar(d) {
  const ahora = new Date();
  const bonos = d.bonos || [];
  // El bono en uso: el primero que no se ha terminado; si todos lo están, el último.
  const actual = bonos.find((b) => estado(b, ahora).quedan > 0) || bonos[bonos.length - 1];
  const cabecera = `
    <header class="bono-cab">
      <img src="/logo.webp" alt="" width="56" height="56" />
      <p class="club" translate="no">Padel Mes Malgrat</p>
      <h1>${esc(d.nombre)}</h1>
    </header>`;
  if (!actual) {
    $bono.innerHTML = cabecera + `<section class="tarjeta"><p class="grande-txt">Todavía no tienes ningún bono.</p></section>`;
    return;
  }
  const e = estado(actual, ahora);
  const todas = bonos.flatMap((b) => b.sesiones);
  const ultima = todas.filter((s) => new Date(s.fin) <= ahora).at(-1);
  const proxima = todas.find((s) => new Date(s.fin) > ahora);
  const terminado = e.quedan === 0;
  const precio = actual.precio ? ` · ${euros(actual.precio)}${actual.tarifa === "equipo" ? " (equipo)" : ""}` : "";

  $bono.innerHTML = cabecera + `
    <section class="tarjeta">
      <p class="tipo">${esc(actual.tipo)}${precio}</p>
      <p class="quedan${terminado ? " fin" : ""}"><span class="num">${e.quedan}</span><span class="txt">${e.quedan === 1 ? "clase te queda" : "clases te quedan"}</span></p>
      ${casillas(actual, e)}
      ${terminado ? `<p class="aviso">Bono terminado. Habla con Jordi para renovarlo.</p>` : ""}
    </section>
    <section class="tarjeta filas">
      <div class="fila"><span class="et">Última clase</span><span class="val">${ultima ? `${larga(ultima.inicio)}` : "—"}</span></div>
      <div class="fila"><span class="et">Próxima clase</span><span class="val">${proxima ? `${larga(proxima.inicio)}, ${hora(proxima.inicio)}` : "sin fecha todavía"}</span></div>
    </section>
    <details class="tarjeta truco">
      <summary>Tenerlo siempre a mano</summary>
      <p><b>iPhone:</b> botón compartir <span aria-hidden="true">⎙</span> → «Añadir a pantalla de inicio».</p>
      <p><b>Android:</b> menú <span aria-hidden="true">⋮</span> → «Añadir a pantalla de inicio».</p>
      <p>Te quedará un icono como una app. También puedes volver a abrir el enlace del WhatsApp.</p>
    </details>
    <p class="pie">Actualizado ${larga(d.actualizado)}, ${hora(d.actualizado)}</p>`;
}

async function iniciar() {
  const token = new URLSearchParams(location.search).get("c") || "";
  if (token.length < 20 && URL_SB) {
    $bono.innerHTML = `<section class="tarjeta"><p class="grande-txt">Este enlace no está completo.</p><p>Vuelve a abrirlo desde el WhatsApp de Jordi.</p></section>`;
    return;
  }
  try {
    const d = await cargar(token);
    if (!d) {
      $bono.innerHTML = `<section class="tarjeta"><p class="grande-txt">Tu bono se está preparando.</p><p>Vuelve a abrir el enlace en un rato.</p></section>`;
      return;
    }
    pintar(d);
    // Si la página se queda abierta, se repinta para que las clases se tachen solas.
    setInterval(() => pintar(d), 60_000);
  } catch {
    $bono.innerHTML = `<section class="tarjeta"><p class="grande-txt">No se ha podido cargar.</p><p>Revisa la conexión y vuelve a intentarlo.</p><p><button class="btn-bono" type="button" onclick="location.reload()">Volver a intentarlo</button></p></section>`;
  }
}

iniciar();
