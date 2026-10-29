// Página pública del bono de un alumno: /bono/?c=<código>
// Sin cuenta: lee su foto con pass_view (supabase/bonos.sql). Las clases
// previstas se dan por hechas solas en cuanto acaba su hora.
// La foto la publica app/scripts/bonos-web.js (segundo cerebro): bonos, agenda de la semana,
// renovar (ahorro del pack de 10) y, si hay campaña, los productos para elegir.
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/archivo-black/latin-400.css";
import "./bono.css";
import { esc } from "./ui.js";

const URL_SB = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ZONA = "Europe/Madrid";
const WHATSAPP_JORDI = "34658755499";
const MANANA = "14:00"; // antes de esta hora el calendario solo enseña clases abiertas
const $bono = document.getElementById("bono");

const fecha = (iso, opts) => new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, ...opts }).format(new Date(iso));
const corta = (iso) => fecha(iso, { day: "numeric", month: "numeric" });
const larga = (iso) => fecha(iso, { weekday: "long", day: "numeric", month: "numeric" });
const hora = (iso) => fecha(iso, { hour: "2-digit", minute: "2-digit" });
const hoyMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
const horaMadrid = () => hora(new Date().toISOString());
const euros = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
const DIAS = ["D", "L", "M", "X", "J", "V", "S"];
const DIAS_LARGO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const diaDe = (f) => new Date(f + "T12:00:00Z").getUTCDay();
const numDe = (f) => Number(f.slice(8));
const wa = (texto) => `https://wa.me/${WHATSAPP_JORDI}?text=${encodeURIComponent(texto)}`;

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
  return demo();
}

// Sin Supabase (modo demo): un bono de ejemplo para ver la página.
function demo() {
  const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat("en-CA").format(d); };
  const h = (dias, hh) => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(hh, 0, 0, 0); return d; };
  const s = (dias, hh) => ({ inicio: h(dias, hh).toISOString(), fin: h(dias, hh + 1).toISOString() });
  return {
    nombre: "Andrea Bravo", actualizado: new Date().toISOString(),
    bonos: [{ tipo: "Bono 10 clases compartido", precio: 0, tarifa: "general", clases: 10, antes: 4, sesiones: [s(2, 19)] }],
    agenda: {
      dias: Array.from({ length: 7 }, (_, i) => dia(i)),
      items: [
        { f: dia(0), h: "22:00", t: "li" },
        { f: dia(1), h: "10:00", t: "ab", plazas: 4, apuntados: 2, nivel: "B", genero: "Chicos" },
        { f: dia(1), h: "17:00", t: "oc" }, { f: dia(1), h: "18:00", t: "li" },
        { f: dia(2), h: "19:00", t: "ab", plazas: 4, apuntados: 3, nivel: "C", genero: "Mixto" }, { f: dia(2), h: "20:30", t: "li" },
        { f: dia(4), h: "17:00", t: "li" }, { f: dia(4), h: "18:00", t: "oc" },
      ],
    },
    renovar: { clases: 10, precio: 150, ahorro: 12.5 },
    elegir: { titulo: "Otoño", hasta: dia(62), cada: 3, llevas: 1, productos: [
      { nombre: "Pala Wilson", img: "pala.webp", antes: 229, ahora: "−15 %" },
      { nombre: "Sudadera del club", img: "sudadera.webp", antes: 48, ahora: 35 },
      { nombre: "Gorra Wilson", img: "gorra.webp", antes: 35, ahora: 0 },
    ] },
  };
}

// Estado de un bono ahora mismo.
function estado(b, ahora) {
  const hechas = b.sesiones.filter((s) => new Date(s.fin) <= ahora);
  const futuras = b.sesiones.filter((s) => new Date(s.fin) > ahora);
  const usadas = b.antes + hechas.length;
  return { hechas, futuras, usadas, quedan: Math.max(0, b.clases - usadas) };
}

// Una entrada por clase: picada (hecha), con fecha (prevista) o en blanco.
function entradas(b, e) {
  const out = [];
  for (let i = 0; i < b.clases; i++) {
    const n = `<b>${i + 1}</b>`;
    if (i < b.antes) out.push(`<li class="on">${n}<i>hecha</i></li>`);
    else if (i < e.usadas) out.push(`<li class="on">${n}<i>${corta(e.hechas[i - b.antes].inicio)}</i></li>`);
    else {
      const s = e.futuras[i - e.usadas];
      out.push(s ? `<li class="nx">${n}<i>${b.clases > 5 ? corta(s.inicio) : `${corta(s.inicio)} · ${hora(s.inicio)}`}</i></li>` : `<li>${n}</li>`);
    }
  }
  return `<ol class="tix${b.clases > 5 ? " c10" : ""}" aria-label="${e.usadas} de ${b.clases} clases hechas">${out.join("")}</ol>`;
}

const precioProducto = (p) => (typeof p.ahora === "string" ? esc(p.ahora) : p.ahora === 0 ? "Gratis" : euros(p.ahora));

// La barra cuenta clases: los bonos ya acabados de la campaña enteros, más las hechas del actual.
// Ej.: 3 bonos de 10 = 30 clases; Andrea, en su primer bono con 4 hechas, va por 4 de 30.
function tarjetaElegir(el, actual, e) {
  const faltan = el.cada - el.llevas;
  const [, m, d] = el.hasta.split("-").map(Number);
  const dias = Math.max(0, Math.ceil((new Date(el.hasta + "T23:59:59") - new Date()) / 864e5));
  const porBono = actual.clases;
  const total = el.cada * porBono;
  const hechas = Math.min(total, Math.max(0, el.llevas - 1) * porBono + e.usadas);
  const pct = Math.round((hechas / total) * 100);
  const texto = (p) => `Hola Jordi, ${faltan ? "me gustaría ir a por" : "elijo"}: ${p.nombre} 🎾`;
  return `
    <section class="c c-fino">
      <div class="fh"><span>${esc(el.titulo)}</span><span>hasta el ${d} de ${MESES[m - 1]}</span></div>
      <h2>Con ${el.cada} bonos, eliges uno</h2>
      <div class="prods">${el.productos.map((p) => `
        <a class="pr" href="${wa(texto(p))}" target="_blank" rel="noopener">
          <div class="im"><img src="/premios/${encodeURIComponent(p.img)}" alt="" loading="lazy" /></div>
          <b>${esc(p.nombre)}</b><span>${p.antes ? `<s>${euros(p.antes)}</s>` : ""}${precioProducto(p)}</span>
        </a>`).join("")}
      </div>
      <div class="pgr" aria-hidden="true"><div class="ln"><span style="width:${pct}%"></span></div>
        <div class="pn">${Array.from({ length: el.cada }, (_, i) => `<i style="left:${((i + 1) / el.cada) * 100}%" class="${hechas >= (i + 1) * porBono ? "on" : i === el.cada - 1 ? "end" : ""}"></i>`).join("")}</div></div>
      <div class="fm"><b>${hechas} de ${total} clases</b><span>${faltan ? `Te faltan ${faltan} · quedan ${dias} días` : "¡Ya puedes elegir!"}</span></div>
    </section>`;
}

// ---------- Calendario de la semana ----------
let ancho = false; // "Ampliar": todas las horas con algo (por la mañana solo hay clases abiertas)
let sel = null;    // hueco elegido: "fecha_hora"
const idDe = (x) => `${x.f}_${x.h}`;

function itemsVisibles(agenda) {
  const hoy = hoyMadrid();
  const ahora = horaMadrid();
  return (agenda.items || []).filter((x) => x.f > hoy || (x.f === hoy && x.h > ahora));
}

function celda(x) {
  const cls = `k ${x.t}${sel === idDe(x) ? " sel" : ""}`;
  if (x.t === "oc") return `<div class="${cls}" aria-label="Ocupado">—</div>`;
  if (x.t === "li") return `<button type="button" class="${cls}" data-sel="${idDe(x)}">${x.h.endsWith(":00") ? "Libre" : x.h}</button>`;
  const puntos = Array.from({ length: x.plazas }, (_, i) => `<i class="${i < x.apuntados ? "" : "e"}"></i>`).join("");
  return `<button type="button" class="${cls}" data-sel="${idDe(x)}">de ${x.plazas}<span class="pp">${puntos}</span></button>`;
}

function detalle(x) {
  if (!x) return `<p class="vacio">Esta semana está todo lleno. Escríbeme y buscamos un hueco.</p>`;
  const cuando = `${DIAS_LARGO[diaDe(x.f)]} ${numDe(x.f)} · ${x.h}`;
  if (x.t === "ab") {
    const faltan = x.plazas - x.apuntados;
    const extra = [x.nivel && `Nivel ${esc(x.nivel)}`, esc(x.genero), `🔥 ${faltan === 1 ? "falta 1" : `faltan ${faltan}`}`].filter(Boolean).join(" · ");
    return `<div class="det"><div><b>${cuando} · Clase de ${x.plazas}</b><span>${extra}</span></div><a class="go" href="${wa(`Hola Jordi, me apunto a la clase de ${x.plazas} del ${cuando} 🎾`)}" target="_blank" rel="noopener">Me apunto</a></div>`;
  }
  return `<div class="det li"><div><b>${cuando} · Libre</b><span>Clase para ti (o con quien quieras)</span></div><a class="go" href="${wa(`Hola Jordi, ¿me guardas la clase del ${cuando}? 🎾`)}" target="_blank" rel="noopener">La quiero</a></div>`;
}

function calendario(agenda) {
  const items = itemsVisibles(agenda);
  const horaNum = (x) => Number(x.h.slice(0, 2));
  // Siempre de 17 a 20 h y las horas con clase abierta; ampliado, también el resto de horas con algo.
  const horas = new Set([17, 18, 19, 20]);
  for (const x of items) if (ancho || x.t === "ab") horas.add(horaNum(x));
  const tocables = items.filter((x) => x.t !== "oc");
  if (!tocables.some((x) => idDe(x) === sel)) {
    const primero = tocables.find((x) => x.t === "ab") || tocables[0];
    sel = primero ? idDe(primero) : null;
  }

  let g = `<div class="grid${ancho ? " ancho" : ""}"><div></div>` + agenda.dias.map((f) => `<div class="gh">${DIAS[diaDe(f)]}<b>${numDe(f)}</b></div>`).join("");
  for (const hr of [...horas].sort((a, b) => a - b)) {
    g += `<div class="hr">${hr}h</div>`;
    for (const f of agenda.dias) {
      const aqui = items.filter((x) => x.f === f && horaNum(x) === hr);
      const x = aqui.find((y) => y.t === "ab") || aqui.find((y) => y.t === "li") || aqui[0];
      g += x ? celda(x) : `<div class="k"></div>`;
    }
  }
  g += `</div><div class="ley"><span><i style="background:rgba(61,220,151,.4);border:1.5px solid #3ddc97"></i>Libre: pídela</span><span><i style="background:#ff5a5f"></i>Abierta: falta gente</span><span><i style="background:#3a4468"></i>Ocupado</span></div>`;

  return `
    <section class="c" id="cal">
      <div class="calh"><div class="lbl">📅 ¿Cuándo vienes?</div><button type="button" data-ancho>${ancho ? "‹ Menos" : "Ampliar ›"}</button></div>
      ${g}${detalle(items.find((y) => idDe(y) === sel))}
      <p class="manana">☀️ Mañanas: clases solo con reserva previa y según disponibilidad.</p>
    </section>`;
}

function tarjetaRenovar(d, quedan) {
  const el = d.elegir;
  let titulo = "Tu próximo bono, con un toque";
  if (el && el.llevas < el.cada) {
    const tras = el.cada - el.llevas - 1;
    titulo = tras === 0 ? "Renueva y eliges" : `Renueva y estarás a ${tras === 1 ? "1 bono" : `${tras} bonos`} de elegir`;
  }
  const r = d.renovar;
  const queda = quedan ? ` (me ${quedan === 1 ? "queda 1 clase" : `quedan ${quedan} clases`})` : "";
  return `
    <section class="c c-next">
      <div class="lbl">🔁 Tu siguiente bono</div>
      <h2>${titulo}</h2>
      <a class="btnw" href="${wa(`Hola Jordi, quiero renovar mi bono 🎾${queda}`)}" target="_blank" rel="noopener">Renovar mi bono</a>
      ${r ? `<p class="save">Pack de ${r.clases} (${euros(r.precio)}): ahorras <b>${euros(r.ahorro)}</b></p>` : ""}
    </section>`;
}

// Guardar el bono en la pantalla de inicio: pasos grandes solo para su móvil.
// Si ya lo abre desde el icono (modo app), no se enseña.
function tarjetaAMano() {
  const enApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (enApp) return "";
  const ua = navigator.userAgent;
  const iphone = /iPhone|iPad|iPod/.test(ua);
  const android = /Android/.test(ua);
  const pasos = (titulo, lista) => `<p class="am-os">${titulo}</p><ol class="am-pasos">${lista.map((p) => `<li><span>${p}</span></li>`).join("")}</ol>`;
  const ios = pasos("En iPhone", ["Toca el botón <b>Compartir</b> <span class=\"am-ico\" aria-hidden=\"true\">⬆︎</span> de abajo.", "Baja y toca <b>«Añadir a pantalla de inicio»</b>.", "Toca <b>«Añadir»</b>. ¡Listo!"]);
  const andr = pasos("En Android", ["Toca los <b>tres puntos</b> <span class=\"am-ico\" aria-hidden=\"true\">⋮</span> de arriba a la derecha.", "Toca <b>«Añadir a pantalla de inicio»</b>.", "Toca <b>«Añadir»</b>. ¡Listo!"]);
  return `
    <section class="c c-amano">
      <h2>📲 Ten tu bono a un toque</h2>
      <p class="am-sub">Guárdalo en el móvil y te saldrá un icono como el de una app.</p>
      ${iphone ? ios : android ? andr : ios + andr}
      <p class="am-nota">Si lo has abierto desde WhatsApp y no ves esos botones, toca primero «Abrir en el navegador».</p>
    </section>`;
}

let datos = null;

function pintar() {
  const d = datos;
  const ahora = new Date();
  const bonos = d.bonos || [];
  // El bono en uso: el primero que no se ha terminado; si todos lo están, el último.
  const actual = bonos.find((b) => estado(b, ahora).quedan > 0) || bonos[bonos.length - 1];
  const cabecera = `
    <header class="hd">
      <img src="/logo.webp" alt="" width="48" height="48" />
      <div><p class="club" translate="no" style="margin:0">Padel Mes Malgrat</p><h1>${esc(d.nombre)}</h1></div>
    </header>`;
  if (!actual) {
    $bono.innerHTML = cabecera + `<section class="c c-bono"><p class="grande-txt">Todavía no tienes ningún bono.</p></section>`;
    return;
  }
  const e = estado(actual, ahora);
  const proxima = bonos.flatMap((b) => b.sesiones).find((s) => new Date(s.fin) > ahora);
  const terminado = e.quedan === 0;
  const precio = actual.precio ? ` · ${euros(actual.precio)}${actual.tarifa === "equipo" ? " (equipo)" : ""}` : actual.precio === 0 ? " · regalo" : "";
  const sub = proxima ? `Próxima: ${larga(proxima.inicio)} · ${hora(proxima.inicio)}` : terminado ? "Bono terminado" : "Elige tu próxima clase abajo";

  $bono.innerHTML = cabecera + `
    <section class="c c-bono">
      <div class="q${terminado ? " fin" : ""}"><b class="num">${e.quedan}</b>
        <span>${e.quedan === 1 ? "clase te queda" : "clases te quedan"}<small>${sub}</small></span></div>
      ${entradas(actual, e)}
      <p class="sub">${esc(actual.tipo)}${precio}</p>
      ${terminado ? `<p class="aviso">Renuévalo abajo para seguir jugando.</p>` : ""}
    </section>
    ${tarjetaAMano()}
    ${d.elegir ? tarjetaElegir(d.elegir, actual, e) : ""}
    ${d.agenda ? calendario(d.agenda) : ""}
    ${tarjetaRenovar(d, e.quedan)}
    <p class="pie">Actualizado ${larga(d.actualizado)}, ${hora(d.actualizado)}</p>`;
}

$bono.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-sel], [data-ancho]");
  if (!t) return;
  if (t.hasAttribute("data-ancho")) ancho = !ancho;
  else sel = t.dataset.sel;
  pintar();
});

async function iniciar() {
  const token = new URLSearchParams(location.search).get("c") || "";
  if (token.length < 20 && URL_SB) {
    $bono.innerHTML = `<section class="c"><p class="grande-txt">Este enlace no está completo.</p><p>Vuelve a abrirlo desde el WhatsApp de Jordi.</p></section>`;
    return;
  }
  try {
    datos = await cargar(token);
    if (!datos) {
      $bono.innerHTML = `<section class="c"><p class="grande-txt">Tu bono se está preparando.</p><p>Vuelve a abrir el enlace en un rato.</p></section>`;
      return;
    }
    pintar();
    // Si la página se queda abierta, se repinta para que las clases se tachen solas.
    setInterval(pintar, 60_000);
  } catch {
    $bono.innerHTML = `<section class="c"><p class="grande-txt">No se ha podido cargar.</p><p>Revisa la conexión y vuelve a intentarlo.</p><p><button class="btn-bono" type="button" onclick="location.reload()">Volver a intentarlo</button></p></section>`;
  }
}

iniciar();
