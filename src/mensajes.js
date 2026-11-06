/* Textos de WhatsApp de las reservas. Sin pantalla ni base de datos, para
   poder probarlos solos: npm run test:msg */
import { samePerson } from "./ui.js";
import { addDays, dayTitle, hhmm, local, parseDay, today, weekday } from "./time.js";

/* ["Pista 1", "Pista 2", "Pista 3"] → "Pista 1, Pista 2 y Pista 3". */
export const andList = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} y ${a.at(-1)}`);
/* "todos los sábados" / "todos los lunes" (sábado y domingo llevan -s). */
export const weekdays = (key) => weekday(key).replace(/o$/, "os");
export const firstName = (n) => String(n ?? "").trim().split(/\s+/)[0] ?? "";
const dateLong = (key) => parseDay(key).toLocaleDateString("es-ES", { day: "numeric", month: "long" });

/* Pistas en orden de la agenda: [2, 1] → ["Pista 1", "Pista 2"]. */
export function courtNames(app, ids) {
  const order = (id) => {
    const i = app.courts.findIndex((c) => c.id === Number(id));
    return i < 0 ? 99 : i;
  };
  return [...new Set(ids.map(Number))].sort((a, b) => order(a) - order(b)).map((id) => app.courts.find((c) => c.id === id)?.name ?? `Pista ${id}`);
}

/* Para el mensaje: "la Pista 1", "las pistas 1 y 2", "las pistas 1, 2 y 3". */
export function courtsPhrase(app, ids) {
  const names = courtNames(app, ids);
  if (names.length === 1) return /^pista\b/i.test(names[0]) ? `la ${names[0]}` : names[0];
  const nums = names.map((n) => n.match(/^pista\s+(\S+)$/i)?.[1]);
  return nums.every(Boolean) ? `las pistas ${andList(nums)}` : andList(names);
}

/* Mensaje para el titular (el de siempre). courtLabel sustituye al nombre de
   la pista cuando son varias (p. ej. "las pistas 1 y 2"). */
export function confirmText(app, b, untilKey, courtLabel) {
  const s = app.settings ?? {};
  const court = courtLabel ?? app.courts.find((c) => c.id === Number(b.court_id))?.name ?? `Pista ${b.court_id}`;
  const a = local(b.starts_at);
  const z = local(b.ends_at);
  const first = firstName(b.name);
  const when = untilKey
    ? `todos los ${weekdays(a.day)} de ${hhmm(a.min)} a ${hhmm(z.min)}, desde el ${dateLong(a.day)} hasta el ${dateLong(untilKey)}`
    : `el ${dayTitle(a.day).toLowerCase().replace(",", "")}, de ${hhmm(a.min)} a ${hhmm(z.min)}`;
  return `Hola${first ? ` ${first}` : ""}, te confirmo la reserva en ${s.club_name ?? "Padel Mes Malgrat"}: ${court}, ${when}. ¡Nos vemos en la pista!`;
}

const CONFIRMED = {
  partido: "Partido confirmado",
  clase: "Clase confirmada",
  escuela: "Clase confirmada",
  snp: "Partido SNP confirmado",
  americana: "Americana confirmada",
  torneo: "Torneo confirmado",
};

/* "hoy, jueves 6, a las 17:30" · "mañana, viernes 7, a las 9:00" ·
   "el sábado 15 de noviembre a las 17:30" · con repetición, "todos los
   jueves a las 17:30, desde hoy hasta el 25 de diciembre,". */
export function whenText(day, start, untilKey, now = today()) {
  const wd = weekday(day);
  const n = parseDay(day).getDate();
  const isToday = day === now;
  const isTomorrow = day === addDays(now, 1);
  if (untilKey) return `todos los ${weekdays(day)} a las ${hhmm(start)}, desde ${isToday ? "hoy" : isTomorrow ? "mañana" : `el ${dateLong(day)}`} hasta el ${dateLong(untilKey)},`;
  const rel = isToday ? `hoy, ${wd} ${n},` : isTomorrow ? `mañana, ${wd} ${n},` : `el ${wd} ${dateLong(day)}`;
  return `${rel} a las ${hhmm(start)}`;
}

/* WhatsApp para cada jugador de la reserva, p. ej.:
   "¡Hola Diego! ✅ Partido confirmado hoy, jueves 6, a las 17:30 en la Pista 1
   de *Padel Mes Malgrat*, a nombre de José Calero. ¡Nos vemos!"
   r = { kind, day, start, courts: [ids], untilKey, holder: { name, phone, player_id } }
   El titular es una persona si tiene teléfono o ficha, o si es un partido; si
   no (una americana, la escuela…), su nombre va como título entre paréntesis. */
export function playerText(app, r, player, now = today()) {
  const club = app.settings?.club_name ?? "Padel Mes Malgrat";
  const hi = firstName(player.name);
  const h = r.holder ?? {};
  const person = !!h.name && !!(h.phone || h.player_id || r.kind === "partido");
  const what = (CONFIRMED[r.kind] ?? "Reserva confirmada") + (h.name && !person ? ` (${h.name})` : "");
  const who = !person ? "" : samePerson(player, h) ? ", a tu nombre" : `, a nombre de ${h.name}`;
  return `¡Hola${hi ? ` ${hi}` : ""}! ✅ ${what} ${whenText(r.day, r.start, r.untilKey, now)} en ${courtsPhrase(app, r.courts)} de *${club}*${who}. ¡Nos vemos!`;
}
