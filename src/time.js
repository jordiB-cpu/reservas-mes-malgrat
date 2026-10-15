/* Fechas y horas en hora local (el club está en Europa/Madrid y Mily usa
   la app allí). En la base de datos se guarda timestamptz; aquí se trabaja
   con "YYYY-MM-DD" para los días y minutos desde medianoche para las horas. */

export const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayKey(new Date());

export function parseDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/* Día + minutos → ISO (con la zona del navegador). */
export function at(key, min) {
  const d = parseDay(key);
  d.setMinutes(min);
  return d.toISOString();
}
/* ISO → { day, min } en hora local. */
export function local(iso) {
  const d = new Date(iso);
  return { day: dayKey(d), min: d.getHours() * 60 + d.getMinutes() };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const dayTitle = (key) => cap(parseDay(key).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }));
export const dayShort = (key) => cap(parseDay(key).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, ""));
export const weekday = (key) => parseDay(key).toLocaleDateString("es-ES", { weekday: "long" });

export function weeksBetween(fromKey, untilKey) {
  const out = [];
  for (let k = fromKey; k <= untilKey; k = addDays(k, 7)) out.push(k);
  return out;
}
